import { load } from "cheerio";

import { PortalError } from "../../../core/errors/portal-error.js";
import type { Course } from "../../../core/models/schemas.js";
import { sourceReference } from "../../../core/provenance/source-reference.js";
import type { PageSnapshot } from "../../../auth/browser-session.js";
import { cleanText, firstText } from "../parsing/html.js";

const COURSE_SELECTOR =
  "[data-course-id], [data-courseid], .course-info-container, .coursebox, li.course-listitem";

export function parseMoodleCourses(snapshot: PageSnapshot): Course[] {
  const $ = load(snapshot.html);
  const nodes = $(COURSE_SELECTOR).filter((_index, node) => {
    return $(node).find('a[href*="/course/view.php?id="]').length > 0;
  });
  if (nodes.length === 0) {
    if ($('[data-region="course-content"], #page-my-courses').length > 0)
      return [];
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Moodle course containers were not found",
      {
        source: "moodle",
      },
    );
  }

  const courses = new Map<string, Course>();
  nodes.each((_index, node) => {
    const $node = $(node);
    const link = $node.find('a[href*="/course/view.php?id="]').first();
    const rawHref = link.attr("href");
    if (rawHref === undefined) return;
    const url = new URL(rawHref, snapshot.url);
    const moodleCourseId =
      $node.attr("data-course-id") ??
      $node.attr("data-courseid") ??
      url.searchParams.get("id") ??
      undefined;
    if (moodleCourseId === undefined) return;
    const name =
      firstText($node, [
        ".coursename",
        ".course-name",
        '[data-region="course-name"]',
      ]) ?? cleanText(link.text());
    if (name === "") return;
    const category =
      $node.attr("data-category") ??
      firstText($node, [
        ".categoryname",
        ".course-category",
        '[data-region="course-category"]',
      ]) ??
      "";
    const instructors = $node
      .find('.teachers a, .teacher a, [data-region="instructors"] a')
      .map((_i, instructor) => cleanText($(instructor).text()))
      .get()
      .filter(Boolean);
    const school = category.startsWith("正規科目/")
      ? category.split("/")[1]
      : undefined;
    const syllabusKey = $node.attr("data-syllabus-key");
    const classCode = $node.attr("data-class-code");
    const scheduleMatch = name.match(
      /([日月火水木金土])(?:曜(?:日)?)?\s*(\d+)\s*(?:時限|限)/,
    );
    const weekday = $node.attr("data-weekday") ?? scheduleMatch?.[1];
    const period = $node.attr("data-period") ?? scheduleMatch?.[2];
    const yearMatch = `${category} ${name}`.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
    courses.set(moodleCourseId, {
      id: `waseda:moodle:${moodleCourseId}`,
      institution: "waseda",
      name,
      regular: category.startsWith("正規科目/"),
      moodleCourseId,
      ...(syllabusKey === undefined ? {} : { syllabusKey }),
      ...(classCode === undefined ? {} : { classCode }),
      ...(school === undefined ? {} : { school }),
      ...(yearMatch?.[1] === undefined ? {} : { year: Number(yearMatch[1]) }),
      ...(instructors.length === 0 ? {} : { instructors }),
      sourceRefs: [
        sourceReference("moodle", url.toString(), snapshot.observedAt),
      ],
      extensions: {
        moodleCategory: category,
        ...(weekday === undefined || period === undefined
          ? {}
          : { schedule: { weekdayLabel: `${weekday}曜日`, period } }),
      },
    });
  });
  if (courses.size === 0)
    throw new PortalError(
      "PAGE_STRUCTURE_CHANGED",
      "Moodle courses lacked identifiers",
    );
  return [...courses.values()];
}
