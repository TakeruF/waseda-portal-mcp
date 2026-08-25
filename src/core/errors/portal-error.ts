export const portalErrorCodes = [
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "MAINTENANCE",
  "SOURCE_UNAVAILABLE",
  "PAGE_STRUCTURE_CHANGED",
  "AMBIGUOUS_COURSE_MATCH",
  "RATE_LIMITED",
  "READ_ONLY_VIOLATION",
] as const;

export type PortalErrorCode = (typeof portalErrorCodes)[number];

export class PortalError extends Error {
  readonly code: PortalErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PortalErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function asPortalError(error: unknown): PortalError {
  if (error instanceof PortalError) return error;
  return new PortalError(
    "SOURCE_UNAVAILABLE",
    error instanceof Error ? error.message : "Unknown error",
  );
}
