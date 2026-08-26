import { describe, it } from "vitest";

import { WasedaAdapter } from "../../src/adapters/waseda/waseda-adapter.js";
import { LiveWasedaSources } from "../../src/adapters/waseda/sources.js";
import { BrowserSession } from "../../src/auth/browser-session.js";
import { loadConfig } from "../../src/config/config.js";
import { TtlCache } from "../../src/core/cache/ttl-cache.js";
import { syllabusSearchHitSchema } from "../../src/core/models/schemas.js";

function requireCheck(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("public Web Syllabus catalog live validation", () => {
  it("finds a topic from content and resolves the returned title without logging data", async () => {
    const config = loadConfig({
      headless: true,
      cacheEnabled: true,
      cacheTtlMs: 600_000,
      minAccessIntervalMs: 1_000,
      maxSyllabusCandidates: 2,
    });
    const browser = new BrowserSession(config);
    const adapter = new WasedaAdapter(
      new LiveWasedaSources(browser, new TtlCache(true, config.cacheTtlMs), {
        minAccessIntervalMs: 1_000,
        maxSyllabusCandidates: 2,
        maxAssignmentDetails: 0,
      }),
      undefined,
      {
        schemaVersion: 1,
        affiliations: ["例示学部"],
        academicLevel: "undergraduate",
        year: 3,
        completedPrerequisites: [],
      },
    );
    try {
      const content = await adapter.searchSyllabi({
        query: "日本の貨幣の歴史を学びたい",
        mode: "content",
        relatedTerms: ["貨幣"],
        maxResults: 2,
      });
      requireCheck(
        content.results.length > 0,
        "Content catalog search returned no safe candidates",
      );
      requireCheck(
        content.profileApplied &&
          content.results.every((hit) => hit.eligibility !== undefined),
        "Synthetic academic profile was not applied to catalog results",
      );
      for (const hit of content.results) syllabusSearchHitSchema.parse(hit);

      const title = content.results[0]!.syllabus.courseName;
      const byName = await adapter.searchSyllabi({
        query: title,
        mode: "course_name",
        maxResults: 1,
      });
      requireCheck(
        byName.results.length > 0,
        "Direct course-name catalog search returned no syllabus",
      );

      const audit = browser.auditSnapshot();
      requireCheck(
        audit.syllabusSearchPostsAllowed === 2,
        "Catalog validation did not use exactly two official search requests",
      );
      requireCheck(
        audit.mutationRequestsAllowed === 0,
        "A mutation request was sent during public catalog validation",
      );
    } finally {
      await browser.close();
    }
  }, 120_000);
});
