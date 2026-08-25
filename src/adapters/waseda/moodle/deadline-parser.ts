import { createHash } from "node:crypto";

import { load } from "cheerio";

import type { PageSnapshot } from "../../../auth/browser-session.js";
import { PortalError } from "../../../core/errors/portal-error.js";
import type { Deadline } from "../../../core/models/schemas.js";
import { sourceReference } from "../../../core/provenance/source-reference.js";
import { normalizeSourceDateTime } from "../../../core/time/jst.js";
import { firstAttribute, firstText } from "../parsing/html.js";

const EVENT_SELECTOR =
  "[data-deadline-id], [data-event-kind], .eventlist .event, .calendarwrapper .event, .activity.deadline";

function activityType(value: string): Deadline["activityType"] {
  if (/assign|課題/i.test(value)) return "assignment";
  if (/quiz|小テスト/i.test(value)) return "quiz";
  if (/questionnaire|アンケート/i.test(value)) return "questionnaire";
  if (/forum|フォーラム/i.test(value)) return "forum";
  return "other";
}

function sourceStatus(value: string): Deadline["status"] {
  if (/not[_ -]?submitted|未提出/i.test(value)) return "not_submitted";
  if (/submitted|提出済/i.test(value)) return "submitted";
  if (/completed|完了済|完了/i.test(value)) return "completed";
  return "unknown";
}

export function parseMoodleDeadlines(
  snapshot: PageSnapshot,
  now = new Date(),
): Deadline[] {
  const $ = load(snapshot.html);
  const nodes = $(EVENT_SELECTOR);
  if (nodes.length === 0) {
    if ($('.eventlist, [data-region="event-list-content"]').length > 0)
      return [];
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Moodle deadline containers were not found",
      {
        source: "moodle",
      },
    );
  }
  const results: Deadline[] = [];
  nodes.each((_index, node) => {
    const $node = $(node);
    const rawHref =
      firstAttribute($node, ['a[href*="/mod/"]', "a[href]"], "href") ??
      $node.attr("data-url");
    if (rawHref === undefined) return;
    const url = new URL(rawHref, snapshot.url).toString();
    const title =
      firstText($node, [
        ".name",
        ".eventname",
        ".activityname",
        "h3",
        "h4",
        "a",
      ]) ?? "";
    if (title === "") return;
    const year = Number($node.attr("data-year") ?? new Date().getFullYear());
    const opensRaw =
      $node.attr("data-opens-at") ??
      firstAttribute(
        $node,
        ["time.opens", '[data-field="opens"] time'],
        "datetime",
      ) ??
      firstText($node, [".opens", '[data-field="opens"]']);
    const dueRaw =
      $node.attr("data-due-at") ??
      firstAttribute(
        $node,
        ["time.due", '[data-field="due"] time', "time[datetime]"],
        "datetime",
      ) ??
      firstText($node, [".due", '[data-field="due"]', ".date"]);
    const opensAt =
      opensRaw === undefined
        ? undefined
        : normalizeSourceDateTime(opensRaw, year);
    const dueAt =
      dueRaw === undefined ? undefined : normalizeSourceDateTime(dueRaw, year);
    const rawStatus = `${$node.attr("data-status") ?? ""} ${firstText($node, [".status", ".completion-info"]) ?? ""}`;
    let status = sourceStatus(rawStatus);
    if (
      dueAt !== undefined &&
      Date.parse(dueAt) < now.getTime() &&
      !["submitted", "completed"].includes(status)
    ) {
      status = "overdue";
    }
    const explicitId =
      $node.attr("data-deadline-id") ?? new URL(url).searchParams.get("id");
    const id =
      explicitId ??
      createHash("sha256")
        .update(`${url}\0${title}\0${dueAt ?? ""}`)
        .digest("hex")
        .slice(0, 16);
    const courseId = $node.attr("data-course-id");
    const kind = `${$node.attr("data-event-kind") ?? ""} ${$node.attr("class") ?? ""} ${url}`;
    results.push({
      id: `waseda:moodle:deadline:${id}`,
      ...(courseId === undefined
        ? {}
        : { courseId: `waseda:moodle:${courseId}` }),
      title,
      activityType: activityType(kind),
      ...(opensAt === undefined ? {} : { opensAt }),
      ...(dueAt === undefined ? {} : { dueAt }),
      status,
      url,
      sourceRefs: [sourceReference("moodle", url, snapshot.observedAt)],
    });
  });
  return results;
}
