import * as z from "zod/v4";

export const academicProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    affiliations: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
    academicLevel: z
      .enum(["undergraduate", "masters", "doctoral", "other"])
      .optional(),
    year: z.number().int().min(1).max(6).optional(),
    completedPrerequisites: z
      .array(z.string().trim().min(1).max(120))
      .max(30)
      .default([]),
  })
  .strict()
  .refine(
    (profile) =>
      profile.affiliations.length > 0 ||
      profile.academicLevel !== undefined ||
      profile.year !== undefined ||
      profile.completedPrerequisites.length > 0,
    { message: "At least one academic profile field is required" },
  );

export type AcademicProfile = z.infer<typeof academicProfileSchema>;
