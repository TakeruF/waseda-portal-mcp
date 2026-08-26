import os from "node:os";
import path from "node:path";

export interface AppConfig {
  timezone: "Asia/Tokyo";
  profileDir: string;
  authStatePath: string;
  academicProfilePath: string;
  mappingCachePath: string;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  maskCourseNamesInLogs: boolean;
  headless: boolean;
  navigationTimeoutMs: number;
  minAccessIntervalMs: number;
  maxCourses?: number;
  maxSyllabusCandidates: number;
  maxAssignmentDetails: number;
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["0", "false", "no"].includes(value.toLowerCase());
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    timezone: "Asia/Tokyo",
    profileDir:
      process.env.WASEDA_PORTAL_PROFILE_DIR ??
      path.join(os.homedir(), ".waseda-portal-mcp", "chrome-profile"),
    authStatePath:
      process.env.WASEDA_PORTAL_AUTH_STATE_PATH ??
      path.join(os.homedir(), ".waseda-portal-mcp", "auth-state.json"),
    academicProfilePath:
      process.env.WASEDA_PORTAL_ACADEMIC_PROFILE_PATH ??
      path.join(os.homedir(), ".waseda-portal-mcp", "academic-profile.json"),
    mappingCachePath:
      process.env.WASEDA_PORTAL_MAPPING_CACHE_PATH ??
      path.join(
        os.homedir(),
        ".waseda-portal-mcp",
        "cache",
        "course-syllabus-map.json",
      ),
    cacheEnabled: envBoolean(process.env.WASEDA_PORTAL_CACHE, true),
    cacheTtlMs: Number(process.env.WASEDA_PORTAL_CACHE_TTL_MS ?? 300_000),
    maskCourseNamesInLogs: envBoolean(
      process.env.WASEDA_PORTAL_MASK_COURSE_NAMES,
      true,
    ),
    headless: envBoolean(process.env.WASEDA_PORTAL_HEADLESS, true),
    navigationTimeoutMs: Number(process.env.WASEDA_PORTAL_TIMEOUT_MS ?? 30_000),
    minAccessIntervalMs: Number(
      process.env.WASEDA_PORTAL_MIN_ACCESS_INTERVAL_MS ?? 250,
    ),
    ...(process.env.WASEDA_PORTAL_MAX_COURSES === undefined
      ? {}
      : { maxCourses: Number(process.env.WASEDA_PORTAL_MAX_COURSES) }),
    maxSyllabusCandidates: Number(
      process.env.WASEDA_PORTAL_MAX_SYLLABUS_CANDIDATES ?? 10,
    ),
    maxAssignmentDetails: Number(
      process.env.WASEDA_PORTAL_MAX_ASSIGNMENT_DETAILS ?? 10,
    ),
    ...overrides,
  };
}
