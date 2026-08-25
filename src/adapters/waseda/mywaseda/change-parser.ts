import { createHash } from "node:crypto";

import { load } from "cheerio";

import type { PageSnapshot } from "../../../auth/browser-session.js";
import { PortalError } from "../../../core/errors/portal-error.js";
import type { CourseChange } from "../../../core/models/schemas.js";
import { sourceReference } from "../../../core/provenance/source-reference.js";
import { cleanText } from "../parsing/html.js";

function changeType(value: string): CourseChange["type"] {
  if (/休講/.test(value)) return "cancellation";
  if (/教室.*変更|教室変更/.test(value)) return "room_change";
  if (/時間.*変更|時限.*変更/.test(value)) return "time_change";
  if (/補講/.test(value)) return "makeup";
  return "other";
}

function normalizeDate(
  value: string,
  year = new Date().getFullYear(),
): string | undefined {
  const match = value.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})/);
  if (match === null) return undefined;
  return `${match[1] ?? year}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

export function parseClassChanges(snapshot: PageSnapshot): CourseChange[] {
  const $ = load(snapshot.html);
  const legacyForm = $("form").filter((_index, form) => {
    const action = $(form).attr("action");
    if (action === undefined || action === "") return false;
    try {
      const actionUrl = new URL(action, snapshot.url);
      return (
        actionUrl.origin === "https://class.waseda.jp" &&
        actionUrl.pathname === "/kyuko/epb3010.htm"
      );
    } catch {
      return false;
    }
  });
  const hasLegacyPageMarker =
    legacyForm.length > 0 && $('input[name="s_mode"]').length > 0;
  const bodyText = cleanText($("body").text());
  const hasExplicitEmptyState = [
    "休講情報はありません",
    "該当する休講情報はありません",
    "該当する情報はありません",
    "検索結果は0件",
  ].some((signal) => bodyText.includes(signal));
  if (hasLegacyPageMarker && hasExplicitEmptyState) return [];

  const preferredTable = $(
    'table[data-source="class-changes"], table#changes, table.kyuko, #main table',
  ).first();
  const semanticTable = $("table")
    .filter((_index, candidate) => {
      const headers = $(candidate)
        .find("tr")
        .first()
        .find("th,td")
        .map((_cellIndex, cell) => cleanText($(cell).text()))
        .get();
      return (
        headers.some((header) => /^(?:科目名|科目|対象科目)$/.test(header)) &&
        headers.some((header) => /^(?:休講日|対象日|日付)$/.test(header))
      );
    })
    .first();
  const table = preferredTable.length > 0 ? preferredTable : semanticTable;
  if (table.length === 0)
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "MyWaseda change table was not found",
    );
  const headers = table
    .find("tr")
    .first()
    .find("th,td")
    .map((_index, cell) => cleanText($(cell).text()))
    .get();
  if (headers.length < 2)
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "MyWaseda change table headers changed",
    );
  const results: CourseChange[] = [];
  table
    .find("tr")
    .slice(1)
    .each((_index, row) => {
      const cells = $(row)
        .find("td")
        .map((_cellIndex, cell) => cleanText($(cell).text()))
        .get();
      if (cells.length === 0) return;
      const record = Object.fromEntries(
        headers.map((header, index) => [header, cells[index] ?? ""]),
      );
      const course =
        record["科目名"] ?? record["科目"] ?? record["対象科目"] ?? "";
      const dateText =
        record["休講日"] ?? record["対象日"] ?? record["日付"] ?? "";
      const typeText = record["区分"] ?? record["種別"] ?? "休講";
      const note = record["備考"] ?? record["内容"] ?? "";
      if (course === "" && note === "") return;
      const effectiveDate = normalizeDate(dateText);
      const description = cleanText(
        [typeText, dateText, course, note].filter(Boolean).join(" / "),
      );
      const id = createHash("sha256")
        .update(description)
        .digest("hex")
        .slice(0, 16);
      results.push({
        id: `waseda:change:${id}`,
        type: changeType(`${typeText} ${note}`),
        ...(effectiveDate === undefined ? {} : { effectiveDate }),
        description,
        sourceRefs: [
          sourceReference("mywaseda", snapshot.url, snapshot.observedAt),
        ],
      });
    });
  return results;
}
