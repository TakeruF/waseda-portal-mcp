import type {
  Course,
  ClassMeeting,
  CourseChange,
  Deadline,
  Syllabus,
} from "./models/schemas.js";
import type {
  CourseIdentifier,
  DateRangeInput,
  DeadlineQuery,
  ListCoursesInput,
} from "./models/inputs.js";

export interface UniversityAdapter {
  listCourses(input?: ListCoursesInput): Promise<Course[]>;
  listMeetings(input: DateRangeInput): Promise<ClassMeeting[]>;
  listDeadlines(input: DeadlineQuery): Promise<Deadline[]>;
  listChanges(input: DateRangeInput): Promise<CourseChange[]>;
  getSyllabus(input: CourseIdentifier): Promise<Syllabus | null>;
}
