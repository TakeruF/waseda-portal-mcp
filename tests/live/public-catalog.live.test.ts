import { describe, it } from "vitest";

import { FetchPageReader } from "../../src/adapters/waseda/fetch-page-reader.js";
import { LiveWasedaSources } from "../../src/adapters/waseda/sources.js";
import { WasedaAdapter } from "../../src/adapters/waseda/waseda-adapter.js";
import { TtlCache } from "../../src/core/cache/ttl-cache.js";
import { syllabusSearchHitSchema } from "../../src/core/models/schemas.js";

function requireCheck(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("public catalog live validation without a browser", () => {
  it("searches and resolves a syllabus over plain HTTP", async () => {
    const adapter = new WasedaAdapter(
      new LiveWasedaSources(
        new FetchPageReader(),
        new TtlCache(true, 600_000),
        {
          minAccessIntervalMs: 1_000,
          maxSyllabusCandidates: 2,
          maxAssignmentDetails: 0,
        },
      ),
    );

    const found = await adapter.searchSyllabi({
      query: "統計",
      mode: "course_name",
      maxResults: 2,
    });
    requireCheck(
      found.results.length > 0,
      "Public catalog search returned no syllabus",
    );
    requireCheck(
      !found.profileApplied,
      "A public deployment must not apply an academic profile",
    );
    for (const hit of found.results) syllabusSearchHitSchema.parse(hit);

    // The returned key has to be fetchable again, or get_syllabus is useless.
    const key = found.results[0]!.syllabus.key;
    const match = await adapter.getSyllabusMatch({ syllabusKey: key });
    requireCheck(
      match.decision === "confirmed" && match.syllabus?.key === key,
      "The syllabusKey returned by search did not resolve back to its syllabus",
    );
    requireCheck(
      match.syllabus.school !== undefined,
      "Offering school was not parsed from the live detail page",
    );
  }, 120_000);
});
