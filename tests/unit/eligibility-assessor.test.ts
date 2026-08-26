import { describe, expect, it } from "vitest";

import { assessSyllabusEligibility } from "../../src/adapters/waseda/matching/eligibility-assessor.js";
import type { AcademicProfile } from "../../src/core/models/academic-profile.js";
import type { Syllabus } from "../../src/core/models/schemas.js";

const profile: AcademicProfile = {
  schemaVersion: 1,
  affiliations: ["例示学部"],
  academicLevel: "undergraduate",
  year: 3,
  completedPrerequisites: ["合成基礎科目"],
};

const syllabus: Syllabus = {
  key: "SYNTH-ELIGIBILITY-01",
  year: 2026,
  courseName: "合成履修条件科目",
  instructors: [],
  allocatedYear: "学部2年以上",
  eligibleAffiliations: "例示学部の学生のみ",
  prerequisites: "合成基礎科目",
  schedules: [],
  deliveryMode: "unknown",
  sourceRefs: [
    {
      source: "syllabus",
      url: "https://example.test/syllabus/SYNTH-ELIGIBILITY-01",
      observedAt: "2026-08-26T00:00:00.000Z",
    },
  ],
};

describe("syllabus eligibility assessment", () => {
  it("uses local context without claiming prerequisite completion", () => {
    const result = assessSyllabusEligibility(syllabus, profile);
    expect(result).toMatchObject({
      status: "review_required",
      advisory: true,
      checks: [
        { criterion: "affiliation", status: "consistent" },
        { criterion: "year", status: "consistent" },
        { criterion: "prerequisite", status: "review_required" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("例示学部");
    expect(JSON.stringify(result)).not.toContain("合成基礎科目");
  });

  it("classifies an explicit allocated-year conflict", () => {
    expect(
      assessSyllabusEligibility(syllabus, { ...profile, year: 1 }).status,
    ).toBe("likely_ineligible");
  });

  it("keeps missing public rules unknown instead of assuming eligibility", () => {
    const result = assessSyllabusEligibility(
      {
        ...syllabus,
        allocatedYear: undefined,
        eligibleAffiliations: undefined,
        prerequisites: undefined,
      },
      profile,
    );
    expect(result.status).toBe("unknown");
    expect(result.checks.every((check) => check.status === "unavailable")).toBe(
      true,
    );
  });
});
