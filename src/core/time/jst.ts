import { PortalError } from "../errors/portal-error.js";

const JST_OFFSET = "+09:00";
const PERIOD_TIMES: Record<string, [string, string]> = {
  "1": ["08:50", "10:30"],
  "2": ["10:40", "12:20"],
  "3": ["13:10", "14:50"],
  "4": ["15:05", "16:45"],
  "5": ["17:00", "18:40"],
  "6": ["18:55", "20:35"],
  "7": ["20:45", "21:35"],
};

export function jstDateTime(date: string, time: string): string {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  const result = `${date}T${normalizedTime}${JST_OFFSET}`;
  if (Number.isNaN(Date.parse(result)))
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      `Invalid source date/time: ${date} ${time}`,
    );
  return result;
}

export function normalizeSourceDateTime(
  raw: string,
  baseYear?: number,
): string | undefined {
  const value = raw
    .trim()
    .replace(/年|\//g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, " ")
    .replace(/\s+/g, " ");
  const isoWithZone = Date.parse(value);
  if (/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && !Number.isNaN(isoWithZone))
    return new Date(isoWithZone).toISOString();
  const match = value.match(
    /(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (match === null) return undefined;
  const year = Number(match[1] ?? baseYear);
  if (!Number.isInteger(year)) return undefined;
  return jstDateTime(
    `${String(year).padStart(4, "0")}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`,
    `${String(match[4]).padStart(2, "0")}:${match[5]}:${match[6] ?? "00"}`,
  );
}

export function jstDayBounds(date: string): { from: string; to: string } {
  return {
    from: jstDateTime(date, "00:00:00"),
    to: jstDateTime(date, "23:59:59"),
  };
}

export function periodDateTimes(
  date: string,
  period: string,
): { startAt?: string; endAt?: string } {
  const number = period.match(/\d+/)?.[0];
  if (number === undefined) return {};
  const times = PERIOD_TIMES[number];
  if (times === undefined) return {};
  return {
    startAt: jstDateTime(date, times[0]),
    endAt: jstDateTime(date, times[1]),
  };
}

export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function weekdayForDate(date: string): number {
  return new Date(`${date}T12:00:00+09:00`).getUTCDay();
}
