import fs from "node:fs/promises";

import type { AcademicProfile } from "../core/models/academic-profile.js";
import { academicProfileSchema } from "../core/models/academic-profile.js";

export async function loadAcademicProfile(
  profilePath: string,
): Promise<AcademicProfile | undefined> {
  let stat;
  try {
    stat = await fs.stat(profilePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!stat.isFile()) throw new Error("Academic profile path is not a file");
  if ((stat.mode & 0o077) !== 0)
    throw new Error("Academic profile must be owner-only (chmod 600)");
  if (process.getuid !== undefined && stat.uid !== process.getuid())
    throw new Error("Academic profile must be owned by the current user");
  const raw = await fs.readFile(profilePath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Academic profile is not valid JSON");
  }
  return academicProfileSchema.parse(value);
}
