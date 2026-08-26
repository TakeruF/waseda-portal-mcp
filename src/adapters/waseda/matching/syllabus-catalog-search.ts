import type {
  Syllabus,
  SyllabusSearchHit,
} from "../../../core/models/schemas.js";

export interface SyllabusCatalogCandidate {
  syllabus: Syllabus;
  matchedSearchTerms: string[];
}

const STOP_WORDS = new Set([
  "から",
  "こと",
  "たい",
  "ため",
  "ついて",
  "です",
  "について",
  "まで",
  "もの",
  "よう",
  "関連",
  "関する",
  "学び",
  "学びたい",
  "学ぶ",
  "科目",
  "講義",
  "授業",
  "知り",
  "知りたい",
  "知る",
  "で",
  "と",
  "に",
  "の",
  "は",
  "へ",
  "を",
]);

const GENERIC_TOPIC_WORDS = new Set([
  "基礎",
  "研究",
  "社会",
  "文化",
  "日本",
  "歴史",
]);

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").trim();
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized === "" || STOP_WORDS.has(normalized) || seen.has(normalized))
      continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms;
}

export function contentSearchTerms(
  query: string,
  relatedTerms: string[] = [],
): string[] {
  if (relatedTerms.length > 0) return uniqueTerms(relatedTerms).slice(0, 3);
  const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  const extracted = [...segmenter.segment(normalize(query))]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
    .filter((term) => {
      const length = [...term].length;
      return length >= 2 || (length === 1 && (term.codePointAt(0) ?? 0) > 0x7f);
    });
  const terms = uniqueTerms(extracted).sort((left, right) => {
    const genericDifference =
      Number(GENERIC_TOPIC_WORDS.has(left)) -
      Number(GENERIC_TOPIC_WORDS.has(right));
    return genericDifference !== 0
      ? genericDifference
      : [...right].length - [...left].length;
  });
  return (terms.length > 0 ? terms : [normalize(query)]).slice(0, 3);
}

const SEARCH_FIELDS = [
  "courseName",
  "overview",
  "plan",
  "evaluation",
  "exam",
] as const;

export function rankSyllabusCatalogCandidates(
  candidates: SyllabusCatalogCandidate[],
  query: string,
  searchTerms: string[],
  mode: "course_name" | "content",
): SyllabusSearchHit[] {
  const normalizedQuery = normalize(query);
  const normalizedTerms = searchTerms.map(normalize);
  return candidates
    .map(({ syllabus, matchedSearchTerms }) => {
      const matchedFields = SEARCH_FIELDS.filter((field) => {
        const value = syllabus[field];
        if (value === undefined) return false;
        const normalizedValue = normalize(value);
        return normalizedTerms.some((term) => normalizedValue.includes(term));
      });
      const normalizedOfficialTerms = new Set(
        matchedSearchTerms.map(normalize),
      );
      const matchedTerms = searchTerms.filter((term) =>
        normalizedOfficialTerms.has(normalize(term)),
      );
      const officialCoverage =
        matchedTerms.length / Math.max(1, searchTerms.length);
      const fieldCoverage =
        matchedFields.length / Math.max(1, SEARCH_FIELDS.length);
      const normalizedCourseName = normalize(syllabus.courseName);
      const nameScore =
        normalizedCourseName === normalizedQuery
          ? 1
          : normalizedCourseName.includes(normalizedQuery)
            ? 0.9
            : matchedFields.includes("courseName")
              ? 0.7
              : 0;
      const relevanceScore =
        mode === "course_name"
          ? Math.max(nameScore, officialCoverage * 0.6)
          : Math.min(1, officialCoverage * 0.65 + fieldCoverage * 0.35);
      return {
        syllabus,
        relevanceScore: Number(relevanceScore.toFixed(3)),
        matchedTerms,
        matchedFields: [...matchedFields],
      };
    })
    .sort(
      (left, right) =>
        right.relevanceScore - left.relevanceScore ||
        left.syllabus.courseName.localeCompare(right.syllabus.courseName, "ja"),
    );
}
