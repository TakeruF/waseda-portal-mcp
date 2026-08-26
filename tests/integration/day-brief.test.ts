import { beforeAll, describe, expect, it } from "vitest";

import { WasedaAdapter } from "../../src/adapters/waseda/waseda-adapter.js";
import { parseAcademicCalendar } from "../../src/adapters/waseda/academic-calendar/calendar-parser.js";
import { parseMoodleCourses } from "../../src/adapters/waseda/moodle/course-parser.js";
import { parseMoodleDeadlines } from "../../src/adapters/waseda/moodle/deadline-parser.js";
import { parseClassChanges } from "../../src/adapters/waseda/mywaseda/change-parser.js";
import type { WasedaSources } from "../../src/adapters/waseda/sources.js";
import { parseSyllabus } from "../../src/adapters/waseda/syllabus/syllabus-parser.js";
import type {
  AcademicEvent,
  Course,
  CourseChange,
  Deadline,
  Syllabus,
} from "../../src/core/models/schemas.js";
import { getDayBrief } from "../../src/tools/day-brief.js";
import { fixtureSnapshot } from "../helpers/fixtures.js";

class FixtureSources implements WasedaSources {
  constructor(
    private readonly courseValues: Course[],
    private readonly deadlineValues: Deadline[],
    private readonly changeValues: CourseChange[],
    private readonly syllabusValue: Syllabus,
    private readonly eventValues: AcademicEvent[],
  ) {}
  courses() {
    return Promise.resolve(this.courseValues);
  }
  deadlines() {
    return Promise.resolve(this.deadlineValues);
  }
  changes() {
    return Promise.resolve(this.changeValues);
  }
  syllabusByKey() {
    return Promise.resolve(this.syllabusValue);
  }
  syllabusCandidates() {
    return Promise.resolve([this.syllabusValue]);
  }
  searchSyllabusCatalog(input: { searchTerms: string[] }) {
    return Promise.resolve([
      {
        syllabus: this.syllabusValue,
        matchedSearchTerms: input.searchTerms,
      },
    ]);
  }
  academicEvents() {
    return Promise.resolve(this.eventValues);
  }
}

describe("fixture-based Waseda integration", () => {
  let adapter: WasedaAdapter;

  beforeAll(async () => {
    const courses = parseMoodleCourses(
      await fixtureSnapshot(
        "moodle-courses.html",
        "https://wsdmoodle.waseda.jp/my/courses.php",
      ),
    );
    const deadlines = parseMoodleDeadlines(
      await fixtureSnapshot(
        "moodle-deadlines.html",
        "https://wsdmoodle.waseda.jp/calendar/view.php",
      ),
      new Date("2026-07-22T03:00:00Z"),
    );
    const changes = parseClassChanges(
      await fixtureSnapshot(
        "class-changes.html",
        "https://class.waseda.jp/kyuko/epb3010.htm",
      ),
    );
    const syllabus = parseSyllabus(
      await fixtureSnapshot(
        "syllabus.html",
        "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=SYNTH-101",
      ),
    );
    const events = parseAcademicCalendar(
      await fixtureSnapshot(
        "academic-calendar.html",
        "https://www.waseda.jp/academic-calendar",
      ),
    );
    adapter = new WasedaAdapter(
      new FixtureSources(courses, deadlines, changes, syllabus, events),
    );
  });

  it("filters non-regular courses by default but can include them", async () => {
    expect(await adapter.listCourses()).toHaveLength(1);
    expect(await adapter.listCourses({ includeNonRegular: true })).toHaveLength(
      2,
    );
  });

  it("searches the full catalog without requiring Moodle enrollment", async () => {
    const byName = await adapter.searchSyllabi({
      query: "人工知能概論",
      mode: "course_name",
      maxResults: 1,
    });
    expect(byName.results).toHaveLength(1);
    expect(byName.profileApplied).toBe(false);
    expect(byName.results[0]?.syllabus.key).toBe("SYNTH-101");

    const byContent = await adapter.searchSyllabi({
      query: "合成された学習テーマを学びたい",
      mode: "content",
      relatedTerms: ["合成"],
      maxResults: 1,
    });
    expect(byContent.searchTerms).toEqual(["合成"]);
    expect(byContent.results[0]?.matchedTerms).toEqual(["合成"]);
  });

  it("excludes completed work and keeps overdue state", async () => {
    const deadlines = await adapter.listDeadlines({
      from: "2026-07-16T00:00:00+09:00",
      to: "2026-07-24T00:00:00+09:00",
      includeCompleted: false,
    });
    expect(deadlines.map((item) => item.id)).toEqual([
      "waseda:moodle:deadline:501",
      "waseda:moodle:deadline:503",
    ]);
    expect(deadlines[1]?.status).toBe("overdue");
  });

  it("combines class, cancellation, due work, and overdue work with MyWaseda priority", async () => {
    const brief = await getDayBrief(adapter, "2026-07-23");
    expect(brief.meetings).toHaveLength(1);
    expect(brief.meetings[0]?.status).toBe("cancelled");
    expect(brief.meetings[0]?.sourceRefs[0]?.source).toBe("mywaseda");
    expect(brief.deadlinesDue.map((item) => item.id)).toEqual([
      "waseda:moodle:deadline:501",
    ]);
    expect(brief.overdueDeadlines.map((item) => item.id)).toEqual([
      "waseda:moodle:deadline:503",
    ]);
    expect(brief.warnings).toEqual([]);
  });

  it("does not apply an unlinked change notice to every meeting", async () => {
    const ref = {
      source: "mywaseda" as const,
      url: "https://class.waseda.jp/kyuko/epb3010.htm",
      observedAt: "2026-07-22T00:00:00.000Z",
    };
    const isolatedAdapter = {
      listMeetings: () =>
        Promise.resolve([
          {
            courseId: "course-a",
            date: "2026-07-23",
            period: "2",
            status: "scheduled" as const,
            sourceRefs: [{ ...ref, source: "syllabus" as const }],
          },
        ]),
      listChanges: () =>
        Promise.resolve([
          {
            id: "unlinked",
            type: "cancellation" as const,
            effectiveDate: "2026-07-23",
            description: "照合不能な休講",
            sourceRefs: [ref],
          },
        ]),
      listDeadlines: () => Promise.resolve([]),
      ambiguityWarnings: () => Promise.resolve([]),
    } as unknown as WasedaAdapter;
    const brief = await getDayBrief(isolatedAdapter, "2026-07-23");
    expect(brief.meetings[0]?.status).toBe("scheduled");
  });
});
