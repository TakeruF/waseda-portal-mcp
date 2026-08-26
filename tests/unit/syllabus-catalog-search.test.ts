import { describe, expect, it } from "vitest";

import {
  contentSearchTerms,
  rankSyllabusCatalogCandidates,
} from "../../src/adapters/waseda/matching/syllabus-catalog-search.js";
import type { Syllabus } from "../../src/core/models/schemas.js";

const syllabus: Syllabus = {
  key: "SYNTH-MONEY-01",
  year: 2026,
  courseName: "合成貨幣史",
  instructors: ["例示 教員"],
  schedules: [],
  deliveryMode: "unknown",
  overview: "貨幣と交換制度の歴史を人工データだけで説明する。",
  plan: "古代から現代までの制度変化を扱う。",
  sourceRefs: [
    {
      source: "syllabus",
      url: "https://example.test/syllabus/SYNTH-MONEY-01",
      observedAt: "2026-08-26T00:00:00.000Z",
    },
  ],
};

describe("syllabus catalog search", () => {
  it("extracts specific topics from a natural Japanese learning goal", () => {
    const terms = contentSearchTerms("日本の貨幣の歴史を学びたい");
    expect(terms[0]).toBe("貨幣");
    expect(terms).toContain("歴史");
    expect(terms).not.toContain("学び");
  });

  it("uses explicit related terms without expanding access", () => {
    expect(
      contentSearchTerms("日本の貨幣の歴史を学びたい", [
        "貨幣",
        "通貨",
        "貨幣",
      ]),
    ).toEqual(["貨幣", "通貨"]);
  });

  it("ranks official full-field matches and reports matching fields", () => {
    const hits = rankSyllabusCatalogCandidates(
      [{ syllabus, matchedSearchTerms: ["貨幣", "歴史"] }],
      "日本の貨幣の歴史を学びたい",
      ["貨幣", "歴史"],
      "content",
    );
    expect(hits[0]).toMatchObject({
      matchedTerms: ["貨幣", "歴史"],
    });
    expect(hits[0]?.matchedFields).toEqual(
      expect.arrayContaining(["courseName", "overview"]),
    );
    expect(hits[0]?.relevanceScore).toBeGreaterThan(0.5);
  });
});
