import path from "node:path";

import { describe, it } from "vitest";

import { LocalSyllabusMappingCache } from "../../src/adapters/waseda/matching/syllabus-mapping-cache.js";
import { LiveWasedaSources } from "../../src/adapters/waseda/sources.js";
import { WasedaAdapter } from "../../src/adapters/waseda/waseda-adapter.js";
import { BrowserSession } from "../../src/auth/browser-session.js";
import { loadConfig } from "../../src/config/config.js";
import { TtlCache } from "../../src/core/cache/ttl-cache.js";
import { getDayBrief } from "../../src/tools/day-brief.js";
import { dayBriefSchema } from "../../src/tools/schemas.js";

function requireCheck(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tomorrowInTokyo(): string {
  const tomorrow = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
}

describe("authenticated minimal read-only live validation", () => {
  it("validates all authenticated stages without persisting personal data", async () => {
    const config = loadConfig({
      headless: true,
      cacheEnabled: true,
      cacheTtlMs: 600_000,
      minAccessIntervalMs: 1_000,
      maxCourses: 1,
      maxSyllabusCandidates: 3,
      maxAssignmentDetails: 1,
    });
    const relativeProfile = path.relative(process.cwd(), config.profileDir);
    requireCheck(
      relativeProfile.startsWith("..") && !path.isAbsolute(relativeProfile),
      "The authenticated profile must remain outside the repository",
    );

    const browser = new BrowserSession(config);
    const sources = new LiveWasedaSources(
      browser,
      new TtlCache(true, config.cacheTtlMs),
      {
        minAccessIntervalMs: config.minAccessIntervalMs,
        maxCourses: 1,
        maxSyllabusCandidates: 3,
        maxAssignmentDetails: 1,
      },
    );
    const adapter = new WasedaAdapter(
      sources,
      new LocalSyllabusMappingCache(config.mappingCachePath),
    );

    try {
      const courses = await adapter.listCourses({ includeNonRegular: false });
      requireCheck(
        courses.length >= 1,
        "Stage 1 failed: no regular course was returned",
      );
      requireCheck(
        courses.every(
          (course) => course.regular && course.sourceRefs.length > 0,
        ),
        "Stage 2 failed: a regular course lacked provenance",
      );

      const deadlines = await sources.deadlines();
      requireCheck(
        Array.isArray(deadlines),
        "Stage 3 failed: Moodle calendar was not parsed",
      );
      const assignments = deadlines.filter(
        (deadline) => deadline.activityType === "assignment",
      );
      if (assignments.length > 0) {
        const detailed = assignments.find(
          (deadline) => deadline.sourceRefs.length >= 2,
        );
        requireCheck(
          detailed?.dueAt !== undefined && detailed.status !== "unknown",
          "Stage 4 failed: one assignment detail lacked a due date or state",
        );
      }

      const changes = await sources.changes();
      requireCheck(
        Array.isArray(changes),
        "Stage 5 failed: class-change page was not parsed",
      );

      const match = await adapter.getSyllabusMatch({
        courseId: courses[0]!.id,
      });
      requireCheck(
        match.decision === "confirmed" ||
          (match.decision === "ambiguous" && match.candidates.length > 0),
        `Stage 6 failed: syllabus resolution returned decision=${match.decision}, candidates=${match.candidates.length}`,
      );

      const academicEvents = await sources.academicEvents();
      requireCheck(
        academicEvents.length > 0 &&
          academicEvents.every((event) => event.sourceRefs.length > 0),
        "Stage 7 failed: academic calendar lacked parsed events or provenance",
      );

      const brief = await getDayBrief(adapter, tomorrowInTokyo());
      try {
        dayBriefSchema.parse(brief);
      } catch {
        throw new Error(
          "Stage 8 failed: day brief did not satisfy its output schema",
        );
      }
      const provenanceComplete = [
        ...brief.meetings,
        ...brief.changes,
        ...brief.deadlinesDue,
        ...brief.overdueDeadlines,
      ].every((item) => item.sourceRefs.length > 0);
      requireCheck(
        provenanceComplete,
        "Stage 8 failed: day brief result lacked provenance",
      );

      const audit = browser.auditSnapshot();
      requireCheck(
        audit.mutationRequestsAllowed === 0,
        "Stage 9 failed: a mutation request was allowed",
      );
      requireCheck(
        audit.syllabusSearchPostsAllowed <= 1,
        "Stage 9 failed: more than one public syllabus search was sent",
      );
    } finally {
      await browser.close();
    }
  }, 180_000);
});
