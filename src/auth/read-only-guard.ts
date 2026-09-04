import { PortalError } from "../core/errors/portal-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MUTATION_PATHS = [
  /\/mod\/assign\/(?:submission|submit|edit)/i,
  /\/mod\/quiz\/attempt/i,
  /\/mod\/feedback\/complete/i,
  /\/mod\/choice\/view/i,
  /\/mod\/forum\/post/i,
  /\/message\/(?:index|send)/i,
  /\/calendar\/event/i,
  /\/course\/togglecompletion/i,
  /\/local\/.*(?:attendance|registration)/i,
];
const MUTATION_QUERY =
  /(?:^|[?&])(?:action|operation|method)=(?:submit|save|delete|update|complete|send|post|enrol|unenrol)(?:&|$)/i;
const MOODLE_READ_ONLY_METHODS = new Set([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_calendar_get_calendar_upcoming_view",
  "core_calendar_get_calendar_monthly_view",
  "core_calendar_get_action_events_by_timesort",
  "media_videojs_get_language",
]);

export type AllowedReadOnlyPost = "syllabus_search" | "moodle_read";

export interface ReadOnlyGuardOptions {
  /**
   * When set, only https requests to these hosts may leave the browser. A
   * public-only deployment passes the public Waseda hosts, which removes
   * Moodle and MyWaseda from reach regardless of any stored cookie.
   */
  allowedHosts?: readonly string[];
}

export class ReadOnlyGuard {
  readonly #allowedHosts: Set<string> | undefined;

  constructor(options: ReadOnlyGuardOptions = {}) {
    this.#allowedHosts =
      options.allowedHosts === undefined
        ? undefined
        : new Set(options.allowedHosts);
  }

  /**
   * Rejects any network request outside the configured host allowlist. Schemes
   * that never reach a Waseda origin (`about:`, `data:`, `blob:`) are ignored.
   */
  assertAllowedHost(rawUrl: string): void {
    if (this.#allowedHosts === undefined) return;
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.protocol === "https:" && this.#allowedHosts.has(url.hostname))
      return;
    throw new PortalError(
      "HOST_NOT_ALLOWED",
      `Blocked a request outside the public host allowlist: ${url.hostname}`,
      { host: url.hostname, url: this.redactUrl(rawUrl) },
    );
  }

  assertSafeRequest(
    method: string,
    rawUrl: string,
    postData?: string | null,
  ): void {
    this.assertAllowedHost(rawUrl);
    const normalizedMethod = method.toUpperCase();
    const url = new URL(rawUrl);
    const safeSearchPayload =
      postData !== undefined &&
      postData !== null &&
      (/(?:^|&)ControllerParameters=JAA103SubCon(?:&|$)/.test(postData) ||
        /name="ControllerParameters"\r?\n\r?\nJAA103SubCon\r?\n/.test(
          postData,
        ));
    const safeSyllabusSearch =
      normalizedMethod === "POST" &&
      url.origin === "https://www.wsl.waseda.jp" &&
      url.pathname === "/syllabus/JAA101.php" &&
      safeSearchPayload;
    const safeMoodleRead = this.isSafeMoodleReadPost(
      normalizedMethod,
      url,
      postData,
    );
    if (
      !SAFE_METHODS.has(normalizedMethod) &&
      !safeSyllabusSearch &&
      !safeMoodleRead
    ) {
      throw new PortalError(
        "READ_ONLY_VIOLATION",
        `Blocked non-read request: ${normalizedMethod}`,
        {
          method: normalizedMethod,
          url: this.redactUrl(rawUrl),
        },
      );
    }
    if (
      MUTATION_PATHS.some((pattern) => pattern.test(url.pathname)) ||
      MUTATION_QUERY.test(url.search)
    ) {
      throw new PortalError(
        "READ_ONLY_VIOLATION",
        "Blocked known mutation URL",
        {
          method: normalizedMethod,
          url: this.redactUrl(rawUrl),
        },
      );
    }
  }

  classifyAllowedPost(
    method: string,
    rawUrl: string,
    postData?: string | null,
  ): AllowedReadOnlyPost | undefined {
    if (method.toUpperCase() !== "POST") return undefined;
    const url = new URL(rawUrl);
    if (
      url.origin === "https://www.wsl.waseda.jp" &&
      url.pathname === "/syllabus/JAA101.php" &&
      postData !== undefined &&
      postData !== null &&
      (/(?:^|&)ControllerParameters=JAA103SubCon(?:&|$)/.test(postData) ||
        /name="ControllerParameters"\r?\n\r?\nJAA103SubCon\r?\n/.test(postData))
    )
      return "syllabus_search";
    return this.isSafeMoodleReadPost("POST", url, postData)
      ? "moodle_read"
      : undefined;
  }

  private isSafeMoodleReadPost(
    method: string,
    url: URL,
    postData?: string | null,
  ): boolean {
    if (
      method !== "POST" ||
      url.origin !== "https://wsdmoodle.waseda.jp" ||
      url.pathname !== "/lib/ajax/service.php" ||
      postData === undefined ||
      postData === null
    )
      return false;
    try {
      const calls: unknown = JSON.parse(postData);
      return (
        Array.isArray(calls) &&
        calls.length > 0 &&
        calls.every((call: unknown) => {
          if (typeof call !== "object" || call === null) return false;
          const methodName = (call as Record<string, unknown>)["methodname"];
          return (
            typeof methodName === "string" &&
            MOODLE_READ_ONLY_METHODS.has(methodName)
          );
        })
      );
    } catch {
      return false;
    }
  }

  redactUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|sess|key|auth|userid|student/i.test(key))
          url.searchParams.set(key, "[REDACTED]");
      }
      return url.toString();
    } catch {
      return "[invalid URL]";
    }
  }
}
