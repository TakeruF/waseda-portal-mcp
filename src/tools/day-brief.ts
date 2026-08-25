import type { WasedaAdapter } from "../adapters/waseda/waseda-adapter.js";
import { jstDayBounds } from "../core/time/jst.js";
import { dayBriefSchema, type DayBrief } from "./schemas.js";

function jstDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export async function getDayBrief(
  adapter: WasedaAdapter,
  date: string,
  includeCompletedDeadlines = false,
): Promise<DayBrief> {
  const bounds = jstDayBounds(date);
  const [rawMeetings, changes, deadlines, warnings] = await Promise.all([
    adapter.listMeetings({ from: date, to: date }),
    adapter.listChanges({ from: date, to: date }),
    adapter.listDeadlines({
      from: "2000-01-01T00:00:00+09:00",
      to: bounds.to,
      includeCompleted: includeCompletedDeadlines,
    }),
    adapter.ambiguityWarnings(),
  ]);
  const meetings = rawMeetings.map((meeting) => {
    const relevant = changes.filter(
      (change) =>
        change.courseId === meeting.courseId && change.effectiveDate === date,
    );
    const cancellation = relevant.find(
      (change) => change.type === "cancellation",
    );
    if (cancellation !== undefined) {
      return {
        ...meeting,
        status: "cancelled" as const,
        sourceRefs: [...cancellation.sourceRefs, ...meeting.sourceRefs],
      };
    }
    const changed = relevant.find((change) =>
      ["room_change", "time_change"].includes(change.type),
    );
    return changed === undefined
      ? meeting
      : {
          ...meeting,
          status: "changed" as const,
          sourceRefs: [...changed.sourceRefs, ...meeting.sourceRefs],
        };
  });
  const deadlinesDue = deadlines.filter(
    (deadline) =>
      deadline.dueAt !== undefined && jstDate(deadline.dueAt) === date,
  );
  const overdueDeadlines = deadlines.filter(
    (deadline) =>
      deadline.dueAt !== undefined &&
      jstDate(deadline.dueAt) < date &&
      deadline.status === "overdue",
  );
  return dayBriefSchema.parse({
    date,
    meetings,
    changes,
    deadlinesDue,
    overdueDeadlines,
    observedAt: new Date().toISOString(),
    warnings,
  });
}
