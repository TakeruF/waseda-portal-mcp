import { PortalError } from "../errors/portal-error.js";

export interface PageSnapshot {
  url: string;
  html: string;
  observedAt: Date;
}

export interface PageReader {
  read(url: string): Promise<PageSnapshot>;
}

export interface SyllabusPageReader extends PageReader {
  searchSyllabus(
    courseName: string,
    instructorName?: string,
    keyword?: string,
  ): Promise<PageSnapshot>;
}

export interface PortalAccessState {
  url: string;
  text: string;
  status?: number;
  hadAuthenticatedCookies: boolean;
}

export function detectPortalAccessFailure(
  state: PortalAccessState,
): PortalError | undefined {
  if (state.status === 429)
    return new PortalError(
      "RATE_LIMITED",
      "The source rate-limited the request",
    );
  if (state.status !== undefined && state.status >= 500) {
    return new PortalError(
      "SOURCE_UNAVAILABLE",
      `The source returned HTTP ${state.status}`,
    );
  }
  if (/メンテナンス|maintenance|サービス停止/i.test(state.text)) {
    return new PortalError(
      "MAINTENANCE",
      "The Waseda service is under maintenance",
    );
  }
  const authenticationPage =
    /\/login(?:\/|\?|$)|auth\/saml|my\.waseda\.jp\/login|iaidp\.ia\.waseda\.jp/i.test(
      state.url,
    ) ||
    state.status === 401 ||
    state.status === 403;
  if (!authenticationPage) return undefined;
  return new PortalError(
    state.hadAuthenticatedCookies ? "SESSION_EXPIRED" : "AUTH_REQUIRED",
    state.hadAuthenticatedCookies
      ? "The saved Waseda session has expired; run `waseda-portal-mcp auth` again"
      : "Authentication is required; run `waseda-portal-mcp auth`",
  );
}
