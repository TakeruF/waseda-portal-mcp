import { load } from "cheerio";

import type { PageSnapshot } from "../../../auth/browser-session.js";
import { PortalError } from "../../../core/errors/portal-error.js";
import type { Deadline } from "../../../core/models/schemas.js";
import { sourceReference } from "../../../core/provenance/source-reference.js";
import { normalizeSourceDateTime } from "../../../core/time/jst.js";
import { cleanText, labeledValues } from "../parsing/html.js";

function findValue(
  values: Map<string, string>,
  labels: string[],
): string | undefined {
  for (const [key, value] of values)
    if (labels.some((label) => key.includes(label))) return value;
  return undefined;
}

export function enrichAssignmentDeadline(
  existing: Deadline,
  snapshot: PageSnapshot,
  now = new Date(),
): Deadline {
  const $ = load(snapshot.html);
  const values = labeledValues($);
  const statusRaw =
    findValue(values, ["提出ステータス", "提出状況", "Submission status"]) ??
    cleanText(
      $(
        '.submissionstatus, [data-region="submission-status"], .completion-info',
      ).text(),
    );
  const dueRaw =
    findValue(values, ["提出期限", "終了日時", "Due date"]) ??
    $('time[data-region="due-date"], time.due').first().attr("datetime");
  const opensRaw =
    findValue(values, ["開始日時", "提出開始", "Allow submissions from"]) ??
    $('time[data-region="open-date"], time.opens').first().attr("datetime");
  if (
    statusRaw === undefined &&
    dueRaw === undefined &&
    opensRaw === undefined
  ) {
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Moodle assignment detail fields were not found",
    );
  }
  const year = new Date().getFullYear();
  const dueAt =
    dueRaw === undefined
      ? existing.dueAt
      : (normalizeSourceDateTime(dueRaw, year) ?? existing.dueAt);
  const opensAt =
    opensRaw === undefined
      ? existing.opensAt
      : (normalizeSourceDateTime(opensRaw, year) ?? existing.opensAt);
  let status: Deadline["status"] = existing.status;
  if (/未提出|not submitted|no attempt/i.test(statusRaw ?? ""))
    status = "not_submitted";
  else if (/提出済|submitted for grading|submitted/i.test(statusRaw ?? ""))
    status = "submitted";
  else if (/完了済|completed/i.test(statusRaw ?? "")) status = "completed";
  if (
    dueAt !== undefined &&
    Date.parse(dueAt) < now.getTime() &&
    !["submitted", "completed"].includes(status)
  )
    status = "overdue";
  return {
    ...existing,
    ...(opensAt === undefined ? {} : { opensAt }),
    ...(dueAt === undefined ? {} : { dueAt }),
    status,
    sourceRefs: [
      sourceReference("moodle", snapshot.url, snapshot.observedAt),
      ...existing.sourceRefs,
    ],
  };
}
