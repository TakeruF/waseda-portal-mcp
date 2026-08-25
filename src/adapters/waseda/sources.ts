import type {
  PageReader,
  SyllabusPageReader,
} from "../../auth/browser-session.js";
import { WASEDA_URLS } from "../../config/urls.js";
import type { TtlCache } from "../../core/cache/ttl-cache.js";
import type {
  AcademicEvent,
  Course,
  CourseChange,
  Deadline,
  Syllabus,
} from "../../core/models/schemas.js";
import { parseAcademicCalendar } from "./academic-calendar/calendar-parser.js";
import { parseMoodleCourses } from "./moodle/course-parser.js";
import { parseMoodleDeadlines } from "./moodle/deadline-parser.js";
import { enrichAssignmentDeadline } from "./moodle/assignment-parser.js";
import { parseClassChanges } from "./mywaseda/change-parser.js";
import {
  parseSyllabus,
  parseSyllabusSearch,
} from "./syllabus/syllabus-parser.js";

export interface WasedaSources {
  courses(): Promise<Course[]>;
  deadlines(): Promise<Deadline[]>;
  changes(): Promise<CourseChange[]>;
  syllabusByKey(key: string): Promise<Syllabus>;
  syllabusCandidates(course: Course): Promise<Syllabus[]>;
  academicEvents(): Promise<AcademicEvent[]>;
}

export class LiveWasedaSources implements WasedaSources {
  constructor(
    private readonly reader: SyllabusPageReader,
    private readonly cache: TtlCache,
  ) {}

  courses(): Promise<Course[]> {
    return this.cache.getOrLoad("moodle:courses", async () =>
      parseMoodleCourses(await this.reader.read(WASEDA_URLS.moodleCourses)),
    );
  }

  deadlines(): Promise<Deadline[]> {
    return this.cache.getOrLoad("moodle:deadlines", async () => {
      const deadlines = parseMoodleDeadlines(
        await this.reader.read(WASEDA_URLS.moodleCalendar),
      );
      const enriched: Deadline[] = [];
      for (const deadline of deadlines) {
        if (deadline.activityType !== "assignment") {
          enriched.push(deadline);
          continue;
        }
        enriched.push(
          enrichAssignmentDeadline(
            deadline,
            await this.reader.read(deadline.url),
          ),
        );
      }
      return enriched;
    });
  }

  changes(): Promise<CourseChange[]> {
    return this.cache.getOrLoad("mywaseda:changes", async () =>
      parseClassChanges(await this.reader.read(WASEDA_URLS.classChanges)),
    );
  }

  syllabusByKey(key: string): Promise<Syllabus> {
    return this.cache.getOrLoad(`syllabus:${key}`, async () => {
      const url = new URL(WASEDA_URLS.syllabusDetail);
      url.searchParams.set("pKey", key);
      url.searchParams.set("pLng", "jp");
      return parseSyllabus(await this.reader.read(url.toString()));
    });
  }

  syllabusCandidates(course: Course): Promise<Syllabus[]> {
    return this.cache.getOrLoad(`syllabus:search:${course.id}`, async () => {
      const result = await this.reader.searchSyllabus(course.name);
      const urls = parseSyllabusSearch(result).slice(0, 10);
      const candidates: Syllabus[] = [];
      for (const url of urls)
        candidates.push(parseSyllabus(await this.reader.read(url)));
      return candidates;
    });
  }

  academicEvents(): Promise<AcademicEvent[]> {
    return this.cache.getOrLoad("academic-calendar", async () =>
      parseAcademicCalendar(
        await (this.reader as PageReader).read(WASEDA_URLS.academicCalendar),
      ),
    );
  }
}
