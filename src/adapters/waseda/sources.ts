import type { SyllabusPageReader } from "../../auth/browser-session.js";
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
import {
  syllabusInstructorSearchQuery,
  syllabusSearchQuery,
} from "./matching/course-matcher.js";
import {
  parseMoodleCourseInstructors,
  parseMoodleCourseRegularity,
  parseMoodleCourses,
} from "./moodle/course-parser.js";
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

export interface LiveWasedaSourceOptions {
  minAccessIntervalMs?: number;
  maxCourses?: number;
  maxSyllabusCandidates?: number;
  maxAssignmentDetails?: number;
}

class SerialAccessLimiter {
  #tail: Promise<void> = Promise.resolve();
  #lastStartedAt = 0;

  constructor(private readonly minimumIntervalMs: number) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => {
      const remaining =
        this.minimumIntervalMs - (Date.now() - this.#lastStartedAt);
      if (remaining > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      this.#lastStartedAt = Date.now();
      return operation();
    });
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function limitedCourseOrder(left: Course, right: Course): number {
  const shapeScore = (course: Course): number => {
    const normalized = course.name.normalize("NFKC");
    const hasTrailingSection = /[A-Z]?\d{2}$/i.test(normalized);
    const tokenCount = normalized.trim().split(/\s+/).length;
    return (
      (hasTrailingSection ? 0 : 10_000) +
      (tokenCount >= 2 && tokenCount <= 4 ? 0 : 1_000) +
      [...normalized].length
    );
  };
  return shapeScore(left) - shapeScore(right);
}

export class LiveWasedaSources implements WasedaSources {
  readonly #limiter: SerialAccessLimiter;
  readonly #maxCourses: number | undefined;
  readonly #maxSyllabusCandidates: number;
  readonly #maxAssignmentDetails: number;

  constructor(
    private readonly reader: SyllabusPageReader,
    private readonly cache: TtlCache,
    options: LiveWasedaSourceOptions = {},
  ) {
    this.#limiter = new SerialAccessLimiter(
      Math.max(0, options.minAccessIntervalMs ?? 250),
    );
    this.#maxCourses = options.maxCourses;
    this.#maxSyllabusCandidates = Math.max(
      1,
      options.maxSyllabusCandidates ?? 10,
    );
    this.#maxAssignmentDetails = Math.max(
      0,
      options.maxAssignmentDetails ?? 10,
    );
  }

  private read(url: string) {
    return this.#limiter.run(() => this.reader.read(url));
  }

  private searchSyllabus(courseName: string, instructorName?: string) {
    return this.#limiter.run(() =>
      this.reader.searchSyllabus(courseName, instructorName),
    );
  }

  courses(): Promise<Course[]> {
    return this.cache.getOrLoad("moodle:courses", async () => {
      const courses = parseMoodleCourses(
        await this.read(WASEDA_URLS.moodleCourses),
      );
      const classified: Course[] = [];
      const candidates =
        this.#maxCourses === undefined
          ? courses
          : [...courses].sort(limitedCourseOrder);
      for (const course of candidates) {
        let resolved = course;
        if (!course.regular) {
          const detail = await this.read(course.sourceRefs[0]!.url);
          if (parseMoodleCourseRegularity(detail)) {
            const instructors = parseMoodleCourseInstructors(detail);
            resolved = {
              ...course,
              regular: true,
              ...(instructors.length === 0 ? {} : { instructors }),
              sourceRefs: [
                ...course.sourceRefs,
                {
                  source: "moodle",
                  url: detail.url,
                  observedAt: detail.observedAt.toISOString(),
                },
              ],
              extensions: {
                ...course.extensions,
                regularityEvidence: "course_breadcrumb",
              },
            };
          }
        }
        if (this.#maxCourses === undefined || resolved.regular)
          classified.push(resolved);
        if (
          this.#maxCourses !== undefined &&
          classified.length >= this.#maxCourses
        )
          break;
      }
      return classified;
    });
  }

  deadlines(): Promise<Deadline[]> {
    return this.cache.getOrLoad("moodle:deadlines", async () => {
      const deadlines = parseMoodleDeadlines(
        await this.read(WASEDA_URLS.moodleCalendar),
      );
      const enriched: Deadline[] = [];
      let detailsRead = 0;
      for (const deadline of deadlines) {
        if (
          deadline.activityType !== "assignment" ||
          detailsRead >= this.#maxAssignmentDetails
        ) {
          enriched.push(deadline);
          continue;
        }
        detailsRead += 1;
        enriched.push(
          enrichAssignmentDeadline(deadline, await this.read(deadline.url)),
        );
      }
      return enriched;
    });
  }

  changes(): Promise<CourseChange[]> {
    return this.cache.getOrLoad("mywaseda:changes", async () =>
      parseClassChanges(await this.read(WASEDA_URLS.classChanges)),
    );
  }

  syllabusByKey(key: string): Promise<Syllabus> {
    return this.cache.getOrLoad(`syllabus:${key}`, async () => {
      const url = new URL(WASEDA_URLS.syllabusDetail);
      url.searchParams.set("pKey", key);
      url.searchParams.set("pLng", "jp");
      return parseSyllabus(await this.read(url.toString()));
    });
  }

  syllabusCandidates(course: Course): Promise<Syllabus[]> {
    return this.cache.getOrLoad(`syllabus:search:${course.id}`, async () => {
      const instructor = course.instructors?.[0];
      const result =
        instructor === undefined
          ? await this.searchSyllabus(syllabusSearchQuery(course.name))
          : await this.searchSyllabus(
              "",
              syllabusInstructorSearchQuery(instructor),
            );
      const urls = parseSyllabusSearch(result).slice(
        0,
        this.#maxSyllabusCandidates,
      );
      const candidates: Syllabus[] = [];
      for (const url of urls)
        candidates.push(parseSyllabus(await this.read(url)));
      return candidates;
    });
  }

  academicEvents(): Promise<AcademicEvent[]> {
    return this.cache.getOrLoad("academic-calendar", async () =>
      parseAcademicCalendar(await this.read(WASEDA_URLS.academicCalendar)),
    );
  }
}
