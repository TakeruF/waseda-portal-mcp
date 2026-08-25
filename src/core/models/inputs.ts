import * as z from "zod/v4";

export const listCoursesInputSchema = z.object({
  includeNonRegular: z.boolean().default(false),
});

export const dateRangeInputSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => from <= to, {
    message: "from must not be after to",
  });

export const deadlineQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    includeCompleted: z.boolean().default(false),
  })
  .refine(({ from, to }) => Date.parse(from) <= Date.parse(to), {
    message: "from must not be after to",
  });

export const courseIdentifierSchema = z
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

export type ListCoursesInput = z.input<typeof listCoursesInputSchema>;
export type DateRangeInput = z.infer<typeof dateRangeInputSchema>;
export type DeadlineQuery = z.input<typeof deadlineQuerySchema>;
export type CourseIdentifier = z.infer<typeof courseIdentifierSchema>;
