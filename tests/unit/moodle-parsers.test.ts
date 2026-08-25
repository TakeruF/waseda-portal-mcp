import { describe, expect, it } from "vitest";

import {
  parseMoodleCourseInstructors,
  parseMoodleCourseRegularity,
  parseMoodleCourses,
} from "../../src/adapters/waseda/moodle/course-parser.js";
import { parseMoodleDeadlines } from "../../src/adapters/waseda/moodle/deadline-parser.js";
import { enrichAssignmentDeadline } from "../../src/adapters/waseda/moodle/assignment-parser.js";
import { PortalError } from "../../src/core/errors/portal-error.js";
import { fixtureSnapshot } from "../helpers/fixtures.js";

describe("Moodle parsers", () => {
  it("classifies regular and non-regular courses and retains provenance", async () => {
    const courses = parseMoodleCourses(
      await fixtureSnapshot(
        "moodle-courses.html",
        "https://wsdmoodle.waseda.jp/my/courses.php",
      ),
    );
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({
      regular: true,
      moodleCourseId: "101",
      syllabusKey: "SYNTH-101",
    });
    expect(courses[1]).toMatchObject({ regular: false, moodleCourseId: "999" });
    expect(courses[0]?.sourceRefs[0]?.observedAt).toBe(
      "2026-08-26T00:00:00.000Z",
    );
  });

  it("prefers structured dates and derives completion and overdue status", async () => {
    const deadlines = parseMoodleDeadlines(
      await fixtureSnapshot(
        "moodle-deadlines.html",
        "https://wsdmoodle.waseda.jp/calendar/view.php",
      ),
      new Date("2026-07-22T03:00:00Z"),
    );
    expect(deadlines.map((item) => item.activityType)).toEqual([
      "assignment",
      "quiz",
      "assignment",
    ]);
    expect(deadlines[0]).toMatchObject({
      dueAt: "2026-07-23T14:59:00.000Z",
      status: "not_submitted",
    });
    expect(deadlines[1]?.status).toBe("completed");
    expect(deadlines[2]?.status).toBe("overdue");
    expect(deadlines[0]).not.toHaveProperty("grade");
    expect(deadlines[0]).not.toHaveProperty("feedback");
  });

  it("does not turn a missing major selector into an empty success", () => {
    expect(() =>
      parseMoodleCourses({
        html: "<html><body></body></html>",
        url: "https://example.test",
        observedAt: new Date(),
      }),
    ).toThrow(PortalError);
  });

  it("classifies a course from the full breadcrumb when the list only exposes a leaf category", async () => {
    const snapshot = await fixtureSnapshot(
      "moodle-course-detail.html",
      "https://wsdmoodle.waseda.jp/course/view.php?id=101",
    );
    expect(parseMoodleCourseRegularity(snapshot)).toBe(true);
    expect(parseMoodleCourseInstructors(snapshot)).toEqual(["山田 例"]);
  });

  it("enriches only normalized assignment timing and status from the detail page", async () => {
    const existing = parseMoodleDeadlines(
      await fixtureSnapshot(
        "moodle-deadlines.html",
        "https://wsdmoodle.waseda.jp/calendar/view.php",
      ),
      new Date("2026-07-22T03:00:00Z"),
    )[0];
    expect(existing).toBeDefined();
    const result = enrichAssignmentDeadline(
      existing!,
      await fixtureSnapshot(
        "assignment-detail.html",
        "https://wsdmoodle.waseda.jp/mod/assign/view.php?id=501",
      ),
      new Date("2026-07-22T03:00:00Z"),
    );
    expect(result).toMatchObject({
      status: "not_submitted",
      dueAt: "2026-07-23T23:59:00+09:00",
    });
    expect(JSON.stringify(result)).not.toContain("private-name.pdf");
    expect(JSON.stringify(result)).not.toContain("この値は絶対に取得しない");
  });
});
