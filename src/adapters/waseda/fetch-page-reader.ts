import { ReadOnlyGuard } from "../../auth/read-only-guard.js";
import { PUBLIC_WASEDA_HOSTS, WASEDA_URLS } from "../../config/urls.js";
import { PortalError } from "../../core/errors/portal-error.js";
import {
  detectPortalAccessFailure,
  type PageSnapshot,
  type SyllabusPageReader,
} from "../../core/sources/page-access.js";

const SEARCH_URL = "https://www.wsl.waseda.jp/syllabus/JAA101.php";
const DEFAULT_USER_AGENT =
  "waseda-portal-mcp (+https://github.com/TakeruF/waseda-portal-mcp)";

export interface FetchPageReaderOptions {
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Reads the public Waseda sources over plain HTTP.
 *
 * The public Web Syllabus needs no browser: detail pages are ordinary `GET`
 * responses and its search is a stateless form `POST` that works without a
 * session cookie. Skipping Chromium is what lets the public catalog run on a
 * serverless host, and it keeps the same `ReadOnlyGuard` in front of every
 * request, restricted to the public hosts.
 */
export class FetchPageReader implements SyllabusPageReader {
  readonly #guard = new ReadOnlyGuard({ allowedHosts: PUBLIC_WASEDA_HOSTS });
  readonly #timeoutMs: number;
  readonly #userAgent: string;
  readonly #fetch: typeof fetch;

  constructor(options: FetchPageReaderOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async read(url: string): Promise<PageSnapshot> {
    this.#guard.assertSafeRequest("GET", url);
    return this.send(url, {});
  }

  async searchSyllabus(
    courseName: string,
    instructorName?: string,
    keyword?: string,
  ): Promise<PageSnapshot> {
    // The official form declares multipart, but the controller accepts
    // url-encoded bodies identically, which lets the guard inspect exactly the
    // bytes that are sent.
    const body = new URLSearchParams({
      ControllerParameters: "JAA103SubCon",
      kamoku: courseName,
      kyoin: instructorName ?? "",
      keyword: keyword ?? "",
      pfrontPage: "now",
    }).toString();
    this.#guard.assertSafeRequest("POST", SEARCH_URL, body);
    return this.send(SEARCH_URL, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      referrer: WASEDA_URLS.syllabusSearch,
    });
  }

  private async send(
    url: string,
    init: RequestInit & { referrer?: string },
  ): Promise<PageSnapshot> {
    const { referrer, ...rest } = init;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...rest,
        redirect: "follow",
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: {
          "user-agent": this.#userAgent,
          "accept-language": "ja,en;q=0.8",
          ...(referrer === undefined ? {} : { referer: referrer }),
          ...rest.headers,
        },
      });
    } catch (error) {
      throw new PortalError(
        "SOURCE_UNAVAILABLE",
        "Could not open the Waseda source",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const html = await response.text();
    const failure = detectPortalAccessFailure({
      url: response.url === "" ? url : response.url,
      text: html.replace(/<[^>]+>/g, " ").slice(0, 4000),
      status: response.status,
      hadAuthenticatedCookies: false,
    });
    if (failure !== undefined) throw failure;
    return {
      url: response.url === "" ? url : response.url,
      html,
      observedAt: new Date(),
    };
  }
}
