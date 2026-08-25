import { describe, expect, it } from "vitest";

import { matchCourseToSyllabus } from "../../src/adapters/waseda/matching/course-matcher.js";
import type { Course, Syllabus } from "../../src/core/models/schemas.js";

const ref = {
  source: "syllabus" as const,
  url: "https://example.test/syllabus",
  observedAt: "2026-08-26T00:00:00.000Z",
};
const course: Course = {
  id: "course-1",
  institution: "waseda",
  name: "人工知能概論",
  year: 2026,
  school: "基幹理工学部",
  instructors: ["山田 例"],
  classCode: "01",
  regular: true,
  sourceRefs: [{ ...ref, source: "moodle" as const }],
  extensions: { schedule: { weekdayLabel: "木曜日", period: "2" } },
};
const syllabus: Syllabus = {
  key: "one",
  year: 2026,
  courseName: "人工知能概論",
  classCode: "01",
  school: "基幹理工学部",
  instructors: ["山田例"],
  schedules: [{ weekday: 4, weekdayLabel: "木曜日", period: "2" }],
  deliveryMode: "in_person",
  sourceRefs: [ref],
};

describe("course matcher", () => {
  it("confirms a uniquely strong multi-field match and exposes evidence", () => {
    const result = matchCourseToSyllabus(course, [
      syllabus,
      { ...syllabus, key: "other", courseName: "全く異なる科目" },
    ]);
    expect(result.decision).toBe("confirmed");
    expect(result.syllabus?.key).toBe("one");
    expect(
      result.evidence.some(
        (item) => item.field === "courseName" && item.matched,
      ),
    ).toBe(true);
    expect(
      result.evidence.some((item) => item.field === "schedule" && item.matched),
    ).toBe(true);
  });

  it("does not auto-confirm equally plausible candidates", () => {
    const result = matchCourseToSyllabus(course, [
      syllabus,
      { ...syllabus, key: "two" },
    ]);
    expect(result.decision).toBe("ambiguous");
    expect(result.syllabus).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });
});
