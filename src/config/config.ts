import os from "node:os";
import path from "node:path";

export interface AppConfig {
  timezone: "Asia/Tokyo";
  publicOnly: boolean;
  /** Interface to bind. An empty string binds every interface, IPv6 included. */
  httpHost: string;
  httpPort: number;
  httpAllowedHosts: string[];
  httpAllowedOrigins: string[];
  httpRequestsPerMinute: number;
  httpMaxConcurrentRequests: number;
  profileDir: string;
  authStatePath: string;
  academicProfilePath: string;
  mappingCachePath: string;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  maskCourseNamesInLogs: boolean;
  headless: boolean;
  /** Playwright browser channel. Empty selects Playwright's bundled Chromium, which is what container images ship. */
  browserChannel: string;
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

function envList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const publicOnly = envBoolean(
    process.env.WASEDA_PORTAL_PUBLIC_ONLY,
    overrides.publicOnly ?? false,
  );
  return {
    timezone: "Asia/Tokyo",
    publicOnly,
    httpHost: process.env.WASEDA_PORTAL_HTTP_HOST ?? "127.0.0.1",
    httpPort: Number(
      process.env.WASEDA_PORTAL_HTTP_PORT ?? process.env.PORT ?? 8787,
    ),
    httpAllowedHosts: envList(process.env.WASEDA_PORTAL_HTTP_ALLOWED_HOSTS),
    httpAllowedOrigins: envList(process.env.WASEDA_PORTAL_HTTP_ALLOWED_ORIGINS),
    httpRequestsPerMinute: Number(
      process.env.WASEDA_PORTAL_HTTP_REQUESTS_PER_MINUTE ?? 20,
    ),
    httpMaxConcurrentRequests: Number(
      process.env.WASEDA_PORTAL_HTTP_MAX_CONCURRENT_REQUESTS ?? 4,
    ),
    profileDir:
      process.env.WASEDA_PORTAL_PROFILE_DIR ??
      path.join(
        os.homedir(),
        ".waseda-portal-mcp",
        publicOnly ? "chrome-profile-public" : "chrome-profile",
      ),
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
    browserChannel: process.env.WASEDA_PORTAL_BROWSER_CHANNEL ?? "chrome",
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
