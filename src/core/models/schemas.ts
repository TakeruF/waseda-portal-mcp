import * as z from "zod/v4";

export const sourceReferenceSchema = z.object({
  source: z.enum(["moodle", "mywaseda", "syllabus", "academic_calendar"]),
  url: z.url(),
  observedAt: z.iso.datetime({ offset: true }),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});

export const courseSchema = z.object({
  id: z.string().min(1),
  institution: z.literal("waseda"),
  name: z.string().min(1),
  year: z.number().int().optional(),
  term: z.string().optional(),
  school: z.string().optional(),
  instructors: z.array(z.string()).optional(),
  moodleCourseId: z.string().optional(),
  syllabusKey: z.string().optional(),
  classCode: z.string().optional(),
  regular: z.boolean(),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const classMeetingSchema = z.object({
  courseId: z.string().min(1),
  date: z.iso.date(),
  startAt: z.iso.datetime({ offset: true }).optional(),
  endAt: z.iso.datetime({ offset: true }).optional(),
  period: z.string().optional(),
  campus: z.string().optional(),
  room: z.string().optional(),
  deliveryMode: z
    .enum(["in_person", "online", "on_demand", "hybrid", "unknown"])
    .optional(),
  status: z.enum(["scheduled", "cancelled", "changed", "unknown"]),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
});

export const deadlineSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().optional(),
  title: z.string().min(1),
  activityType: z.enum([
    "assignment",
    "quiz",
    "questionnaire",
    "forum",
    "other",
  ]),
  opensAt: z.iso.datetime({ offset: true }).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum([
    "not_submitted",
    "submitted",
    "completed",
    "overdue",
    "unknown",
  ]),
  url: z.url(),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
});

export const courseChangeSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().optional(),
  type: z.enum([
    "cancellation",
    "room_change",
    "time_change",
    "makeup",
    "other",
  ]),
  effectiveDate: z.iso.date().optional(),
  description: z.string().min(1),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
});

export const syllabusScheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  weekdayLabel: z.string(),
  period: z.string(),
  room: z.string().optional(),
  campus: z.string().optional(),
});

export const syllabusSchema = z.object({
  key: z.string().min(1),
  year: z.number().int(),
  courseName: z.string().min(1),
  classCode: z.string().optional(),
  publicCourseCode: z.string().optional(),
  school: z.string().optional(),
  instructors: z.array(z.string()),
  term: z.string().optional(),
  allocatedYear: z.string().optional(),
  eligibleAffiliations: z.string().optional(),
  prerequisites: z.string().optional(),
  eligibilityNotes: z.array(z.string()).optional(),
  schedules: z.array(syllabusScheduleSchema),
  deliveryMode: z.enum([
    "in_person",
    "online",
    "on_demand",
    "hybrid",
    "unknown",
  ]),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  overview: z.string().optional(),
  plan: z.string().optional(),
  evaluation: z.string().optional(),
  exam: z.string().optional(),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const academicEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "classes_start",
    "classes_end",
    "break",
    "holiday_classes",
    "no_classes",
    "exam",
  ]),
  from: z.iso.date(),
  to: z.iso.date(),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
});

export const matchEvidenceSchema = z.object({
  field: z.enum([
    "year",
    "school",
    "courseName",
    "classCode",
    "instructor",
    "schedule",
  ]),
  matched: z.boolean(),
  weight: z.number(),
  detail: z.string(),
});

export const syllabusMatchSchema = z.object({
  confidence: z.number().min(0).max(1),
  decision: z.enum(["confirmed", "ambiguous", "none"]),
  syllabus: syllabusSchema.optional(),
  candidates: z.array(syllabusSchema),
  evidence: z.array(matchEvidenceSchema),
});

export const syllabusSearchHitSchema = z.object({
  syllabus: syllabusSchema,
  relevanceScore: z.number().min(0).max(1),
  matchedTerms: z.array(z.string()),
  matchedFields: z.array(
    z.enum(["courseName", "overview", "plan", "evaluation", "exam"]),
  ),
  eligibility: z
    .object({
      status: z.enum([
        "potentially_eligible",
        "likely_ineligible",
        "review_required",
        "unknown",
      ]),
      advisory: z.literal(true),
      checks: z.array(
        z.object({
          criterion: z.enum(["affiliation", "year", "prerequisite"]),
          status: z.enum([
            "consistent",
            "conflict",
            "review_required",
            "unavailable",
          ]),
          evidence: z.string().min(1),
        }),
      ),
    })
    .optional(),
});

export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type Course = z.infer<typeof courseSchema>;
export type ClassMeeting = z.infer<typeof classMeetingSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type CourseChange = z.infer<typeof courseChangeSchema>;
export type Syllabus = z.infer<typeof syllabusSchema>;
export type AcademicEvent = z.infer<typeof academicEventSchema>;
export type SyllabusMatch = z.infer<typeof syllabusMatchSchema>;
export type SyllabusSearchHit = z.infer<typeof syllabusSearchHitSchema>;
export type EligibilityAssessment = NonNullable<
  SyllabusSearchHit["eligibility"]
>;
export type EligibilityCheck = EligibilityAssessment["checks"][number];
