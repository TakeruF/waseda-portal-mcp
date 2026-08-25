import os from "node:os";
import path from "node:path";

export interface AppConfig {
  timezone: "Asia/Tokyo";
  profileDir: string;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  maskCourseNamesInLogs: boolean;
  headless: boolean;
  navigationTimeoutMs: number;
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
    cacheEnabled: envBoolean(process.env.WASEDA_PORTAL_CACHE, true),
    cacheTtlMs: Number(process.env.WASEDA_PORTAL_CACHE_TTL_MS ?? 300_000),
    maskCourseNamesInLogs: envBoolean(
      process.env.WASEDA_PORTAL_MASK_COURSE_NAMES,
      true,
    ),
    headless: envBoolean(process.env.WASEDA_PORTAL_HEADLESS, true),
    navigationTimeoutMs: Number(process.env.WASEDA_PORTAL_TIMEOUT_MS ?? 30_000),
    ...overrides,
  };
}
