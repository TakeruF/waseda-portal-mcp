import * as z from "zod/v4";

import {
  classMeetingSchema,
  courseChangeSchema,
  courseSchema,
  deadlineSchema,
  syllabusMatchSchema,
  syllabusSearchHitSchema,
} from "../core/models/schemas.js";
import { syllabusCatalogSearchInputSchema } from "../core/models/inputs.js";

export const getDayBriefInputSchema = z.object({
  date: z.iso.date(),
  includeCompletedDeadlines: z.boolean().default(false),
});

export const listDeadlinesToolInputSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  includeCompleted: z.boolean().default(false),
});

export const listChangesToolInputSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

export const getSyllabusInputSchema = z
  .object({
    courseId: z.string().min(1).optional(),
    syllabusKey: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.courseId !== undefined || value.syllabusKey !== undefined,
    {
      message: "courseId or syllabusKey is required",
    },
  );

export const searchSyllabiInputSchema = syllabusCatalogSearchInputSchema;

export const dayBriefSchema = z.object({
  date: z.iso.date(),
  meetings: z.array(classMeetingSchema),
  changes: z.array(courseChangeSchema),
  deadlinesDue: z.array(deadlineSchema),
  overdueDeadlines: z.array(deadlineSchema),
  observedAt: z.iso.datetime({ offset: true }),
  warnings: z.array(z.string()),
});

export const listCoursesOutputSchema = z.object({
  courses: z.array(courseSchema),
  observedAt: z.iso.datetime({ offset: true }),
});
export const listDeadlinesOutputSchema = z.object({
  deadlines: z.array(deadlineSchema),
  observedAt: z.iso.datetime({ offset: true }),
});
export const listChangesOutputSchema = z.object({
  changes: z.array(courseChangeSchema),
  observedAt: z.iso.datetime({ offset: true }),
});
export const getSyllabusOutputSchema = z.object({
  match: syllabusMatchSchema,
  observedAt: z.iso.datetime({ offset: true }),
});
export const searchSyllabiOutputSchema = z.object({
  query: z.string(),
  mode: z.enum(["course_name", "content"]),
  searchTerms: z.array(z.string()),
  results: z.array(syllabusSearchHitSchema),
  warnings: z.array(z.string()),
  observedAt: z.iso.datetime({ offset: true }),
});

export type DayBrief = z.infer<typeof dayBriefSchema>;
