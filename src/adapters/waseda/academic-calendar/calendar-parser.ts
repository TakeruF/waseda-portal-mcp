import { createHash } from "node:crypto";

import { load } from "cheerio";

import type { PageSnapshot } from "../../../auth/browser-session.js";
import { PortalError } from "../../../core/errors/portal-error.js";
import type { AcademicEvent } from "../../../core/models/schemas.js";
import { sourceReference } from "../../../core/provenance/source-reference.js";
import { cleanText } from "../parsing/html.js";

function eventType(name: string): AcademicEvent["type"] | undefined {
  if (/授業開始/.test(name)) return "classes_start";
  if (/授業終了/.test(name)) return "classes_end";
  if (/休業|休暇/.test(name)) return "break";
  if (/祝日.*授業|授業実施.*祝日/.test(name)) return "holiday_classes";
  if (/授業休止|休講日/.test(name)) return "no_classes";
  if (/試験/.test(name)) return "exam";
  return undefined;
}

function parseDate(raw: string, fallbackYear: number): string | undefined {
  const match = raw.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})/);
  if (match === null) return undefined;
  return `${match[1] ?? fallbackYear}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

export function parseAcademicCalendar(snapshot: PageSnapshot): AcademicEvent[] {
  const $ = load(snapshot.html);
  const rows = $(
    'table[data-source="academic-calendar"] tr, table.academic-calendar tr, .academic-calendar table tr',
  );
  const year = Number(
    cleanText($("h1,h2").first().text()).match(/20\d{2}/)?.[0] ??
      new Date().getFullYear(),
  );
  const events: AcademicEvent[] = [];
  const append = (
    name: string,
    type: AcademicEvent["type"],
    from: string,
    to = from,
  ): void => {
    if (
      events.some(
        (event) =>
          event.name === name && event.from === from && event.to === to,
      )
    )
      return;
    const id = createHash("sha256")
      .update(`${name}\0${from}\0${to}`)
      .digest("hex")
      .slice(0, 16);
    events.push({
      id: `waseda:calendar:${id}`,
      name,
      type,
      from,
      to,
      sourceRefs: [
        sourceReference("academic_calendar", snapshot.url, snapshot.observedAt),
      ],
    });
  };
  rows.each((_index, row) => {
    const cells = $(row)
      .find("th,td")
      .map((_cellIndex, cell) => cleanText($(cell).text()))
      .get();
    if (cells.length < 2) return;
    const name = cells.slice(1).join(" / ");
    const type = eventType(name);
    if (type === undefined) return;
    const dates =
      cells.join(" ").match(/(?:(?:20\d{2})[年/.-])?\d{1,2}[月/.-]\d{1,2}/g) ??
      [];
    const from = dates[0] === undefined ? undefined : parseDate(dates[0], year);
    const to = dates[1] === undefined ? from : parseDate(dates[1], year);
    if (from === undefined || to === undefined) return;
    append(name, type, from, to);
  });
  if (events.length === 0) {
    const bodyText = cleanText($("body").text());
    const namedEvent =
      /(春学期授業開始|秋学期授業開始|春学期授業終了|秋学期授業終了|夏季休業|冬季休業|春季休業)\s*[：:]?\s*((?:20\d{2}年)?\d{1,2}月\d{1,2}日)(?:[^\d]{0,3}～\s*((?:20\d{2}年)?\d{1,2}月\d{1,2}日))?/g;
    for (const match of bodyText.matchAll(namedEvent)) {
      const name = match[1];
      const fromRaw = match[2];
      if (name === undefined || fromRaw === undefined) continue;
      const type = eventType(name);
      const from = parseDate(fromRaw, year);
      const to = parseDate(
        match[3] ?? fromRaw,
        from?.startsWith(String(year + 1)) === true ? year + 1 : year,
      );
      if (type !== undefined && from !== undefined && to !== undefined)
        append(name, type, from, to);
    }
    $("h3").each((_index, heading) => {
      const title = cleanText($(heading).text());
      const type: AcademicEvent["type"] | undefined = /授業を行う祝日/.test(
        title,
      )
        ? "holiday_classes"
        : /臨時の休業日|授業休止日/.test(title)
          ? "no_classes"
          : undefined;
      if (type === undefined) return;
      const section = cleanText($(heading).nextUntil("h3").text());
      for (const raw of section.match(
        /(?:(?:20\d{2})年)?\d{1,2}月\s*\d{1,2}日/g,
      ) ?? []) {
        const date = parseDate(raw.replace(/\s/g, ""), year);
        if (date !== undefined) append(`${title}: ${raw}`, type, date);
      }
    });
  }
  if (events.length === 0)
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Academic calendar event fields were not found",
    );
  return events;
}
