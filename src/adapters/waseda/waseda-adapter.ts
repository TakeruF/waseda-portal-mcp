import { PortalError } from "../../core/errors/portal-error.js";
import type {
  CourseIdentifier,
  DateRangeInput,
  DeadlineQuery,
  ListCoursesInput,
  SyllabusCatalogSearchInput,
} from "../../core/models/inputs.js";
import {
  deadlineQuerySchema,
  listCoursesInputSchema,
  syllabusCatalogSearchInputSchema,
} from "../../core/models/inputs.js";
import type {
  ClassMeeting,
  Course,
  CourseChange,
  Deadline,
  Syllabus,
  SyllabusMatch,
  SyllabusSearchHit,
} from "../../core/models/schemas.js";
import {
  courseSchema,
  deadlineSchema,
  syllabusSchema,
  syllabusSearchHitSchema,
} from "../../core/models/schemas.js";
import {
  datesInRange,
  periodDateTimes,
  weekdayForDate,
} from "../../core/time/jst.js";
import type { UniversityAdapter } from "../../core/university-adapter.js";
import {
  matchCourseToSyllabus,
  normalizeCourseName,
} from "./matching/course-matcher.js";
import {
  contentSearchTerms,
  rankSyllabusCatalogCandidates,
} from "./matching/syllabus-catalog-search.js";
import type { CourseSyllabusMappingCache } from "./matching/syllabus-mapping-cache.js";
import type { WasedaSources } from "./sources.js";

export class WasedaAdapter implements UniversityAdapter {
  constructor(
    private readonly sources: WasedaSources,
    private readonly mappingCache?: CourseSyllabusMappingCache,
  ) {}

  async listCourses(input: ListCoursesInput = {}): Promise<Course[]> {
    const { includeNonRegular } = listCoursesInputSchema.parse(input);
    const courses = (await this.sources.courses()).map((course) =>
      courseSchema.parse(course),
    );
    return includeNonRegular
      ? courses
      : courses.filter((course) => course.regular);
  }

  async searchSyllabi(input: SyllabusCatalogSearchInput): Promise<{
    searchTerms: string[];
    results: SyllabusSearchHit[];
  }> {
    const query = syllabusCatalogSearchInputSchema.parse(input);
    const searchTerms =
      query.mode === "course_name"
        ? [query.query]
        : contentSearchTerms(query.query, query.relatedTerms);
    const candidates = await this.sources.searchSyllabusCatalog({
      mode: query.mode,
      searchTerms,
      maxResults: query.maxResults,
    });
    return {
      searchTerms,
      results: rankSyllabusCatalogCandidates(
        candidates,
        query.query,
        searchTerms,
        query.mode,
      ).map((hit) => syllabusSearchHitSchema.parse(hit)),
    };
  }

  async listDeadlines(input: DeadlineQuery): Promise<Deadline[]> {
    const query = deadlineQuerySchema.parse(input);
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    return (await this.sources.deadlines())
      .map((deadline) => deadlineSchema.parse(deadline))
      .filter((deadline) => {
        const time =
          deadline.dueAt === undefined ? undefined : Date.parse(deadline.dueAt);
        return time !== undefined && time >= from && time <= to;
      })
      .filter(
        (deadline) =>
          query.includeCompleted ||
          !["completed", "submitted"].includes(deadline.status),
      );
  }

  async listChanges(input: DateRangeInput): Promise<CourseChange[]> {
    const courses = await this.listCourses({ includeNonRegular: false });
    return (await this.sources.changes())
      .filter(
        (change) =>
          change.effectiveDate === undefined ||
          (change.effectiveDate >= input.from &&
            change.effectiveDate <= input.to),
      )
      .map((change) => {
        const normalizedDescription = normalizeCourseName(change.description);
        const course = courses.find((candidate) =>
          normalizedDescription.includes(normalizeCourseName(candidate.name)),
        );
        return course === undefined
          ? change
          : { ...change, courseId: course.id };
      });
  }

  async getSyllabus(input: CourseIdentifier): Promise<Syllabus | null> {
    const match = await this.getSyllabusMatch(input);
    return match.decision === "confirmed" ? (match.syllabus ?? null) : null;
  }

  async getSyllabusMatch(input: CourseIdentifier): Promise<SyllabusMatch> {
    if (input.syllabusKey !== undefined) {
      const syllabus = syllabusSchema.parse(
        await this.sources.syllabusByKey(input.syllabusKey),
      );
      return {
        confidence: 1,
        decision: "confirmed",
        syllabus,
        candidates: [syllabus],
        evidence: [],
      };
    }
    const courses = await this.listCourses({ includeNonRegular: true });
    const course = courses.find((candidate) => candidate.id === input.courseId);
    if (course === undefined)
      throw new PortalError(
        "SOURCE_UNAVAILABLE",
        `Unknown courseId: ${input.courseId ?? ""}`,
      );
    const mappedKey =
      course.syllabusKey ?? (await this.mappingCache?.get(course.id));
    if (mappedKey !== undefined) {
      const match = await this.getSyllabusMatch({ syllabusKey: mappedKey });
      if (course.syllabusKey !== undefined)
        await this.mappingCache?.set(course.id, mappedKey);
      return match;
    }
    const match = matchCourseToSyllabus(
      course,
      await this.sources.syllabusCandidates(course),
    );
    if (match.decision === "confirmed" && match.syllabus !== undefined)
      await this.mappingCache?.set(course.id, match.syllabus.key);
    return match;
  }

  async listMeetings(input: DateRangeInput): Promise<ClassMeeting[]> {
    const courses = await this.listCourses({ includeNonRegular: false });
    const events = await this.sources.academicEvents();
    const dates = datesInRange(input.from, input.to);
    const meetings: ClassMeeting[] = [];
    for (const course of courses) {
      const match = await this.getSyllabusMatch({ courseId: course.id });
      if (match.decision !== "confirmed" || match.syllabus === undefined)
        continue;
      for (const date of dates) {
        if (
          events.some(
            (event) =>
              ["break", "no_classes"].includes(event.type) &&
              event.from <= date &&
              event.to >= date,
          )
        )
          continue;
        if (!this.termIncludesDate(match.syllabus.term, date, events)) continue;
        for (const schedule of match.syllabus.schedules.filter(
          (item) => item.weekday === weekdayForDate(date),
        )) {
          meetings.push({
            courseId: course.id,
            date,
            ...periodDateTimes(date, schedule.period),
            period: schedule.period,
            ...(schedule.campus === undefined
              ? {}
              : { campus: schedule.campus }),
            ...(schedule.room === undefined ? {} : { room: schedule.room }),
            deliveryMode: match.syllabus.deliveryMode,
            status: "scheduled",
            sourceRefs: match.syllabus.sourceRefs,
          });
        }
      }
    }
    return meetings;
  }

  private termIncludesDate(
    term: string | undefined,
    date: string,
    events: Awaited<ReturnType<WasedaSources["academicEvents"]>>,
  ): boolean {
    if (term === undefined) return true;
    const season = /春/.test(term)
      ? "春"
      : /秋|冬/.test(term)
        ? "秋"
        : undefined;
    if (season === undefined) return true;
    const start = events.find(
      (event) => event.type === "classes_start" && event.name.includes(season),
    );
    const end = events.find(
      (event) => event.type === "classes_end" && event.name.includes(season),
    );
    if (start !== undefined && date < start.from) return false;
    if (end !== undefined && date > end.to) return false;
    if (start !== undefined || end !== undefined) return true;
    const month = Number(date.slice(5, 7));
    return season === "春"
      ? month >= 4 && month <= 7
      : month >= 10 || month <= 2;
  }

  async ambiguityWarnings(): Promise<string[]> {
    const warnings: string[] = [];
    for (const course of await this.listCourses({ includeNonRegular: false })) {
      const match = await this.getSyllabusMatch({ courseId: course.id });
      if (match.decision === "ambiguous") {
        warnings.push(
          `AMBIGUOUS_COURSE_MATCH: ${normalizeCourseName(course.name)} (${match.candidates.length} candidates, confidence ${match.confidence.toFixed(2)})`,
        );
      }
      if (match.decision === "none")
        warnings.push(
          `No reliable syllabus match for ${normalizeCourseName(course.name)}`,
        );
    }
    return warnings;
  }
}
