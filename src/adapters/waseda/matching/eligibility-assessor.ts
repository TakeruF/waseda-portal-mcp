import type { AcademicProfile } from "../../../core/models/academic-profile.js";
import type {
  EligibilityAssessment,
  EligibilityCheck,
  Syllabus,
} from "../../../core/models/schemas.js";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");
}

function affiliationCheck(
  syllabus: Syllabus,
  profile: AcademicProfile,
): EligibilityCheck {
  if (profile.affiliations.length === 0)
    return {
      criterion: "affiliation",
      status: "unavailable",
      evidence: "No local affiliation is configured.",
    };
  if (syllabus.eligibleAffiliations === undefined)
    return {
      criterion: "affiliation",
      status: "unavailable",
      evidence:
        "The public syllabus has no separately parsed affiliation restriction.",
    };
  const publicRule = normalize(syllabus.eligibleAffiliations);
  const matched = profile.affiliations.some((value) =>
    publicRule.includes(normalize(value)),
  );
  if (matched)
    return {
      criterion: "affiliation",
      status: "consistent",
      evidence:
        "A local affiliation lexically matches the public target-student field.",
    };
  if (/のみ|限定|に限る/.test(publicRule))
    return {
      criterion: "affiliation",
      status: "conflict",
      evidence:
        "The local affiliation does not match an exclusive public target-student field.",
    };
  return {
    criterion: "affiliation",
    status: "review_required",
    evidence: "The public target-student field requires manual interpretation.",
  };
}

function yearCheck(
  syllabus: Syllabus,
  profile: AcademicProfile,
): EligibilityCheck {
  if (profile.year === undefined)
    return {
      criterion: "year",
      status: "unavailable",
      evidence: "No local academic year is configured.",
    };
  if (syllabus.allocatedYear === undefined)
    return {
      criterion: "year",
      status: "unavailable",
      evidence: "The public syllabus has no parsed allocated-year field.",
    };
  const rule = normalize(syllabus.allocatedYear);
  const levelConflict =
    profile.academicLevel !== undefined &&
    ((rule.includes("学部") && profile.academicLevel !== "undergraduate") ||
      (rule.includes("修士") && profile.academicLevel !== "masters") ||
      (rule.includes("博士") && profile.academicLevel !== "doctoral") ||
      (rule.includes("大学院") && profile.academicLevel === "undergraduate"));
  if (levelConflict)
    return {
      criterion: "year",
      status: "conflict",
      evidence:
        "The local academic level conflicts with the public 配当年次 category.",
    };
  if (profile.academicLevel === undefined && /学部|修士|博士|大学院/.test(rule))
    return {
      criterion: "year",
      status: "review_required",
      evidence:
        "The public 配当年次 includes an academic-level category that is not configured locally.",
    };
  const numbers = [...rule.matchAll(/[1-6]/g)].map((match) => Number(match[0]));
  if (numbers.length === 0)
    return {
      criterion: "year",
      status: "review_required",
      evidence:
        "The public allocated-year field requires manual interpretation.",
    };
  const minimumMatch = rule.match(/([1-6])年(?:生)?以上/);
  const maximumMatch = rule.match(/([1-6])年(?:生)?以下/);
  const consistent =
    minimumMatch !== null
      ? profile.year >= Number(minimumMatch[1])
      : maximumMatch !== null
        ? profile.year <= Number(maximumMatch[1])
        : numbers.includes(profile.year);
  return consistent
    ? {
        criterion: "year",
        status: "consistent",
        evidence: "The local academic year is consistent with 配当年次.",
      }
    : {
        criterion: "year",
        status: "conflict",
        evidence: "The local academic year conflicts with 配当年次.",
      };
}

function prerequisiteCheck(
  syllabus: Syllabus,
  profile: AcademicProfile,
): EligibilityCheck {
  const publicRule = [
    syllabus.prerequisites,
    ...(syllabus.eligibilityNotes ?? []),
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  if (publicRule === "")
    return {
      criterion: "prerequisite",
      status: "unavailable",
      evidence:
        "No explicit prerequisite or registration-condition field was parsed.",
    };
  if (profile.completedPrerequisites.length === 0)
    return {
      criterion: "prerequisite",
      status: "review_required",
      evidence:
        "A public prerequisite or registration condition exists, but no local prerequisite hints are configured.",
    };
  const normalizedRule = normalize(publicRule);
  const hasLexicalMatch = profile.completedPrerequisites.some((value) =>
    normalizedRule.includes(normalize(value)),
  );
  return {
    criterion: "prerequisite",
    status: "review_required",
    evidence: hasLexicalMatch
      ? "A local prerequisite hint lexically matches, but the public condition still requires manual confirmation."
      : "Configured prerequisite hints do not resolve the public condition; manual confirmation is required.",
  };
}

export function assessSyllabusEligibility(
  syllabus: Syllabus,
  profile: AcademicProfile,
): EligibilityAssessment {
  const checks = [
    affiliationCheck(syllabus, profile),
    yearCheck(syllabus, profile),
    prerequisiteCheck(syllabus, profile),
  ];
  const status = checks.some((check) => check.status === "conflict")
    ? "likely_ineligible"
    : checks.some((check) => check.status === "review_required")
      ? "review_required"
      : checks.some((check) => check.status === "consistent")
        ? "potentially_eligible"
        : "unknown";
  return { status, advisory: true, checks };
}
