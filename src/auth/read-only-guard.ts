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

export class ReadOnlyGuard {
  assertSafeRequest(
    method: string,
    rawUrl: string,
    postData?: string | null,
  ): void {
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
      url.pathname === "/syllabus/index.php" &&
      safeSearchPayload;
    if (!SAFE_METHODS.has(normalizedMethod) && !safeSyllabusSearch) {
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
