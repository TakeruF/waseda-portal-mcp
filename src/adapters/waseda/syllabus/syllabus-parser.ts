import { load } from "cheerio";

import type { PageSnapshot } from "../../../auth/browser-session.js";
import { PortalError } from "../../../core/errors/portal-error.js";
import type { Syllabus } from "../../../core/models/schemas.js";
import { sourceReference } from "../../../core/provenance/source-reference.js";
import { normalizeSourceDateTime } from "../../../core/time/jst.js";
import { cleanText, labeledValues } from "../parsing/html.js";

const WEEKDAYS: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

function getValue(
  values: Map<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const exact = values.get(key);
    if (exact !== undefined) return exact;
    for (const [label, value] of values) if (label.includes(key)) return value;
  }
  return undefined;
}

function parseSchedules(
  raw: string | undefined,
  fallbackRoom?: string,
  fallbackCampus?: string,
): Syllabus["schedules"] {
  if (raw === undefined) return [];
  const schedules: Syllabus["schedules"] = [];
  const pattern =
    /([日月火水木金土])(?:曜(?:日)?)?\s*[・,/\s]?\s*(\d+(?:[-～]\d+)?)\s*(?:時限|限)/g;
  // Live pages write periods with full-width digits ("水５時限").
  for (const match of raw.normalize("NFKC").matchAll(pattern)) {
    const label = match[1];
    const period = match[2];
    if (label === undefined || period === undefined) continue;
    schedules.push({
      weekday: WEEKDAYS[label] ?? 0,
      weekdayLabel: `${label}曜日`,
      period,
      ...(fallbackRoom === undefined ? {} : { room: fallbackRoom }),
      ...(fallbackCampus === undefined ? {} : { campus: fallbackCampus }),
    });
  }
  return schedules;
}

/** Returns the term token from a value that may also carry a day and period. */
function extractTerm(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const token = raw
    .split(/\s+/)
    .find((part) => /学期|クォーター|通年|集中/.test(part));
  if (token !== undefined) return token;
  return /時限|限/.test(raw) ? undefined : raw;
}

function deliveryMode(value: string): Syllabus["deliveryMode"] {
  if (/オンデマンド/.test(value)) return "on_demand";
  if (/ハイブリッド|併用/.test(value)) return "hybrid";
  if (/オンライン|リアルタイム配信/.test(value)) return "online";
  if (/対面/.test(value)) return "in_person";
  return "unknown";
}

export function parseSyllabus(snapshot: PageSnapshot): Syllabus {
  const $ = load(snapshot.html);
  const values = labeledValues($);
  const courseName =
    getValue(values, ["科目名", "Course Title"]) ??
    cleanText($("h1").first().text());
  const yearRaw = getValue(values, ["年度", "Academic Year"]);
  // `syllabusByKey` re-requests `JAA104.php?pKey=<key>`, so the request key has
  // to be the URL parameter. The page's own 科目キー field is a shorter internal
  // identifier that cannot be fetched again.
  const key =
    new URL(snapshot.url).searchParams.get("pKey") ??
    getValue(values, ["科目キー", "シラバスキー"]) ??
    $("[data-syllabus-key]").first().attr("data-syllabus-key");
  if (courseName === "" || yearRaw === undefined || key === undefined) {
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Required Web Syllabus fields were not found",
    );
  }
  const year = Number(yearRaw.match(/20\d{2}/)?.[0]);
  if (!Number.isInteger(year))
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Web Syllabus year was invalid",
    );
  const instructorsRaw =
    getValue(values, ["担当教員", "科目担当者", "Instructor"]) ?? "";
  const room = getValue(values, ["教室", "Classroom"]);
  const campus = getValue(values, ["キャンパス", "Campus"]);
  const scheduleRaw = getValue(values, [
    "曜日・時限",
    "曜日時限",
    "Day/Period",
  ]);
  // 学期曜日時限 is one field, so the term has to be split back out of it.
  const term = extractTerm(
    values.get("学期") ?? values.get("Term") ?? scheduleRaw,
  );
  // 授業方法区分 carries the delivery mode. 授業形態 is a different field
  // (講義, 演習, 実験) that never names one, and matching it first made every
  // page with both resolve to "unknown".
  const modeRaw =
    getValue(values, ["授業方法区分", "授業方式", "Course Mode"]) ?? "";
  const updatedRaw = getValue(values, [
    "最終更新日時",
    "最終更新日",
    "Last Update",
  ]);
  const updatedAt =
    updatedRaw === undefined
      ? undefined
      : normalizeSourceDateTime(updatedRaw, year);
  const allocatedYear = getValue(values, ["配当年次", "Allocated Year"]);
  const eligibleAffiliations = getValue(values, [
    "対象学生",
    "対象者",
    "対象学部",
    "対象研究科",
    "Eligible Students",
  ]);
  const prerequisites = getValue(values, [
    "前提科目",
    "Prerequisite",
    "Prerequisites",
  ]);
  const eligibilityNotes = [
    getValue(values, ["履修条件", "受講条件", "登録条件"]),
    getValue(values, ["備考・関連URL", "備考", "Remarks"]),
  ]
    .filter((value): value is string => value !== undefined)
    .filter((value) =>
      /前提|履修条件|受講条件|登録条件|対象(?:学生|者|学部|研究科)|履修(?:不可|でき|可)/.test(
        value,
      ),
    );
  return {
    key,
    year,
    courseName,
    ...(getValue(values, ["クラスコード", "Class Code"]) === undefined
      ? {}
      : { classCode: getValue(values, ["クラスコード", "Class Code"]) }),
    ...(getValue(values, [
      "公開コースコード",
      "コース・コード",
      "科目コード",
      "Course Code",
    ]) === undefined
      ? {}
      : {
          publicCourseCode: getValue(values, [
            "公開コースコード",
            "コース・コード",
            "科目コード",
            "Course Code",
          ]),
        }),
    ...(getValue(values, ["開講学部", "開講箇所", "School"]) === undefined
      ? {}
      : { school: getValue(values, ["開講学部", "開講箇所", "School"]) }),
    instructors: instructorsRaw
      .split(/[、,／/]/)
      .map(cleanText)
      .filter(Boolean),
    ...(term === undefined ? {} : { term }),
    ...(allocatedYear === undefined ? {} : { allocatedYear }),
    ...(eligibleAffiliations === undefined ? {} : { eligibleAffiliations }),
    ...(prerequisites === undefined ? {} : { prerequisites }),
    ...(eligibilityNotes.length === 0 ? {} : { eligibilityNotes }),
    schedules: parseSchedules(scheduleRaw, room, campus),
    deliveryMode: deliveryMode(modeRaw),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(getValue(values, ["授業概要", "Course Outline"]) === undefined
      ? {}
      : { overview: getValue(values, ["授業概要", "Course Outline"]) }),
    ...(getValue(values, [
      "授業計画",
      "授業スケジュール",
      "Course Schedule",
    ]) === undefined
      ? {}
      : {
          plan: getValue(values, [
            "授業計画",
            "授業スケジュール",
            "Course Schedule",
          ]),
        }),
    ...(getValue(values, ["評価方法", "成績評価", "Evaluation"]) === undefined
      ? {}
      : {
          evaluation: getValue(values, ["評価方法", "成績評価", "Evaluation"]),
        }),
    ...(getValue(values, ["試験", "Exam"]) === undefined
      ? {}
      : { exam: getValue(values, ["試験", "Exam"]) }),
    sourceRefs: [
      sourceReference("syllabus", snapshot.url, snapshot.observedAt, updatedAt),
    ],
  };
}

export function parseSyllabusSearch(snapshot: PageSnapshot): string[] {
  const $ = load(snapshot.html);
  const keys = $('a[onclick*="JAA104DtlSubCon"]')
    .map(
      (_index, node) =>
        $(node)
          .attr("onclick")
          ?.match(/JAA104DtlSubCon['"]\s*,\s*['"]([^'"]+)/)?.[1],
    )
    .get()
    .filter(Boolean);
  if (keys.length > 0) {
    return keys.map(
      (key) =>
        `https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=${encodeURIComponent(key)}&pLng=jp`,
    );
  }
  const links = $('a[href*="JAA104.php"]');
  if (links.length === 0) {
    const text = cleanText($("body").text());
    if (/該当.*(?:ありません|0件)|検索結果.*0\s*件/.test(text)) return [];
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Web Syllabus result links were not found",
    );
  }
  return links
    .map((_index, node) =>
      new URL($(node).attr("href") ?? "", snapshot.url).toString(),
    )
    .get()
    .filter(Boolean);
}
