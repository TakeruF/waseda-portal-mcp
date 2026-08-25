import type {
  Course,
  Syllabus,
  SyllabusMatch,
} from "../../../core/models/schemas.js";

export function normalizeCourseName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/\s/g, "")
    .replace(/[・:：()（）「」『』【】_[\]-]/g, "")
    .replace(
      /(?:20\d{2}|春学期|秋学期|春クォーター|夏クォーター|秋クォーター|冬クォーター)/g,
      "",
    )
    .replace(/[a-z]?\d{2}$/i, "");
}

export function syllabusSearchQuery(value: string): string {
  const withoutSection = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[A-Z]?\d{2}$/i, "")
    .trim();
  const tokens = withoutSection.split(" ").filter(Boolean);
  const first = tokens[0];
  if (first === undefined) return withoutSection;
  if (!/^[\x20-\x7e]+$/.test(first) && [...first].length >= 3) return first;
  return tokens.slice(0, Math.min(2, tokens.length)).join(" ");
}

export function syllabusInstructorSearchQuery(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  const surname = normalized.split(/[,、]/, 1)[0]?.trim();
  if (surname !== undefined && surname !== "" && surname !== normalized)
    return surname;
  return normalized.split(/\s+/, 1)[0] ?? normalized;
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(
    Array.from({ length: value.length - 1 }, (_unused, index) =>
      value.slice(index, index + 2),
    ),
  );
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  return (2 * intersection) / (a.size + b.size || 1);
}

function normalizedPerson(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s,、.・]/g, "");
}

function evaluate(
  course: Course,
  syllabus: Syllabus,
): { score: number; evidence: SyllabusMatch["evidence"] } {
  const nameScore = similarity(
    normalizeCourseName(course.name),
    normalizeCourseName(syllabus.courseName),
  );
  const instructorMatched =
    course.instructors?.some((courseInstructor) =>
      syllabus.instructors.some((instructor) =>
        normalizedPerson(instructor).includes(
          normalizedPerson(courseInstructor),
        ),
      ),
    ) ?? false;
  const extensionSchedule = course.extensions?.schedule;
  const courseSchedule =
    typeof extensionSchedule === "object" && extensionSchedule !== null
      ? (extensionSchedule as { weekdayLabel?: unknown; period?: unknown })
      : undefined;
  const scheduleMatched =
    typeof courseSchedule?.weekdayLabel === "string" &&
    typeof courseSchedule.period === "string" &&
    syllabus.schedules.some(
      (schedule) =>
        schedule.weekdayLabel === courseSchedule.weekdayLabel &&
        schedule.period === courseSchedule.period,
    );
  const checks: Array<
    [SyllabusMatch["evidence"][number]["field"], boolean, number, string]
  > = [
    [
      "year",
      course.year !== undefined && course.year === syllabus.year,
      0.15,
      `${course.year ?? "unknown"} vs ${syllabus.year}`,
    ],
    [
      "school",
      course.school !== undefined &&
        syllabus.school !== undefined &&
        syllabus.school.includes(course.school),
      0.15,
      `${course.school ?? "unknown"} vs ${syllabus.school ?? "unknown"}`,
    ],
    [
      "courseName",
      nameScore >= 0.72,
      0.35 * nameScore,
      `normalized similarity ${nameScore.toFixed(2)}`,
    ],
    [
      "classCode",
      course.classCode !== undefined &&
        syllabus.classCode !== undefined &&
        course.classCode === syllabus.classCode,
      0.15,
      `${course.classCode ?? "unknown"} vs ${syllabus.classCode ?? "unknown"}`,
    ],
    [
      "instructor",
      instructorMatched,
      0.1,
      instructorMatched
        ? "at least one normalized instructor matched"
        : "no instructor match or source value missing",
    ],
    [
      "schedule",
      scheduleMatched,
      0.1,
      scheduleMatched
        ? "Moodle weekday and period matched"
        : "Moodle schedule was missing or did not match",
    ],
  ];
  const evidence = checks.map(([field, matched, weight, detail]) => ({
    field,
    matched,
    weight,
    detail,
  }));
  const score = checks.reduce(
    (total, [, matched, weight]) => total + (matched ? weight : 0),
    0,
  );
  return { score: Math.min(1, score), evidence };
}

export function matchCourseToSyllabus(
  course: Course,
  candidates: Syllabus[],
): SyllabusMatch {
  const ranked = candidates
    .map((syllabus) => ({ syllabus, ...evaluate(course, syllabus) }))
    .sort((left, right) => right.score - left.score);
  const top = ranked[0];
  if (top === undefined)
    return {
      confidence: 0,
      decision: "none",
      candidates,
      evidence: [],
    };
  if (top.score < 0.45)
    return {
      confidence: top.score,
      decision: "ambiguous",
      candidates: ranked.slice(0, 5).map(({ syllabus }) => syllabus),
      evidence: top.evidence,
    };
  const margin = top.score - (ranked[1]?.score ?? 0);
  const decision =
    top.score >= 0.75 && margin >= 0.12 ? "confirmed" : "ambiguous";
  return {
    confidence: top.score,
    decision,
    ...(decision === "confirmed" ? { syllabus: top.syllabus } : {}),
    candidates: ranked.slice(0, 5).map(({ syllabus }) => syllabus),
    evidence: top.evidence,
  };
}
