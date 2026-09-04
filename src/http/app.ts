import fs from "node:fs/promises";

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import type { WasedaAdapter } from "../adapters/waseda/waseda-adapter.js";
import type { AppConfig } from "../config/config.js";
import { asPortalError } from "../core/errors/portal-error.js";
import type { PortalErrorCode } from "../core/errors/portal-error.js";
import { syllabusCatalogSearchInputSchema } from "../core/models/inputs.js";
import { datesInRange, jstDayBounds } from "../core/time/jst.js";
import { createMcpServer } from "../mcp-server.js";
import {
  getSyllabusOutputSchema,
  searchSyllabiOutputSchema,
} from "../tools/schemas.js";
import { ConcurrencyGate, TokenBucketRateLimiter } from "./rate-limiter.js";

/** Protocol chatter (initialize, tools/list) is far cheaper than a catalog read. */
const MCP_RATE_MULTIPLIER = 5;
const MAX_REQUEST_BODY_BYTES = 16_384;
const BUCKET_PRUNE_INTERVAL_MS = 60_000;

const STATUS_BY_ERROR_CODE: Record<PortalErrorCode, number> = {
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  MAINTENANCE: 503,
  SOURCE_UNAVAILABLE: 502,
  PAGE_STRUCTURE_CHANGED: 502,
  AMBIGUOUS_COURSE_MATCH: 409,
  RATE_LIMITED: 429,
  READ_ONLY_VIOLATION: 403,
  HOST_NOT_ALLOWED: 403,
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'none'; base-uri 'none'",
};

export interface FetchAppDeps {
  adapter: WasedaAdapter;
  config: AppConfig;
  onError?: (error: Error) => void;
  /** Starts the owner-controlled, local browser authentication flow. */
  connectPersonalSession?: () => Promise<void>;
}

export interface FetchApp {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first !== undefined && first.length > 0 ? first : "unknown";
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(error: unknown): Response {
  const portalError = asPortalError(error);
  return json(STATUS_BY_ERROR_CODE[portalError.code] ?? 500, {
    error: {
      code: portalError.code,
      message: portalError.message,
      details: portalError.details ?? {},
    },
  });
}

function notFound(pathname: string): Response {
  return json(404, {
    error: { code: "NOT_FOUND", message: `No route for ${pathname}` },
  });
}

function jstDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date = new Date(
    `${value("year")}-${value("month")}-${value("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BODY_BYTES)
    throw new Error("Request body is too large");
  if (raw.trim() === "") return {};
  return JSON.parse(raw);
}

/**
 * The whole HTTP surface as one web-standard handler, so a Node server and a
 * serverless function mount exactly the same routing.
 */
export function createFetchApp(deps: FetchAppDeps): FetchApp {
  const { adapter, config } = deps;
  const onError = deps.onError ?? ((): void => undefined);

  // Served by the static layer on hosts that have one; read lazily so a
  // deployment without the file still answers every other route.
  let indexHtml: Promise<string | undefined> | undefined;
  const loadIndexHtml = (): Promise<string | undefined> => {
    indexHtml ??= fs
      .readFile(new URL("../../public/index.html", import.meta.url), "utf8")
      .catch(() => undefined);
    return indexHtml;
  };

  const mcpHandler = createMcpHandler(
    () => createMcpServer(adapter, { publicOnly: config.publicOnly }),
    { onerror: onError },
  );

  const apiLimiter = new TokenBucketRateLimiter(config.httpRequestsPerMinute);
  const mcpLimiter = new TokenBucketRateLimiter(
    config.httpRequestsPerMinute * MCP_RATE_MULTIPLIER,
  );
  const gate = new ConcurrencyGate(config.httpMaxConcurrentRequests);
  const pruneTimer = setInterval(() => {
    apiLimiter.prune();
    mcpLimiter.prune();
  }, BUCKET_PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();
  let connectionInProgress: Promise<void> | undefined;

  async function handleSearch(request: Request): Promise<Response> {
    const query = syllabusCatalogSearchInputSchema.parse(
      await readJsonBody(request),
    );
    const result = await adapter.searchSyllabi(query);
    return json(
      200,
      searchSyllabiOutputSchema.parse({
        query: query.query,
        mode: query.mode,
        ...result,
        warnings: [
          ...(query.mode === "content"
            ? [
                "内容の関連度は公式Webシラバスの全項目キーワード検索に基づく字句検索です。",
              ]
            : []),
          "履修可否・登録期間・定員は必ず公式情報で確認してください。",
        ],
        observedAt: new Date().toISOString(),
      }),
    );
  }

  async function handleSyllabus(syllabusKey: string): Promise<Response> {
    return json(
      200,
      getSyllabusOutputSchema.parse({
        match: await adapter.getSyllabusMatch({ syllabusKey }),
        observedAt: new Date().toISOString(),
      }),
    );
  }

  /**
   * This route exists only for the loopback, authenticated server. It returns
   * the same intentionally small, read-only models exposed through MCP: no
   * grades, feedback, filenames, credentials, or raw portal pages.
   */
  async function handlePersonalDashboard(): Promise<Response> {
    const from = jstDate();
    const to = jstDate(7);
    const bounds = datesInRange(from, to).map(jstDayBounds);
    const [courses, deadlines, changes] = await Promise.all([
      adapter.listCourses({ includeNonRegular: false }),
      adapter.listDeadlines({
        from: bounds[0]!.from,
        to: bounds.at(-1)!.to,
        includeCompleted: false,
      }),
      adapter.listChanges({ from, to }),
    ]);
    return json(200, { from, to, courses, deadlines, changes });
  }

  async function handlePersonalConnect(): Promise<Response> {
    if (deps.connectPersonalSession === undefined)
      return json(501, {
        error: {
          code: "CONNECT_UNAVAILABLE",
          message: "This server cannot start the local authentication flow.",
        },
      });
    connectionInProgress ??= deps.connectPersonalSession().finally(() => {
      connectionInProgress = undefined;
    });
    await connectionInProgress;
    return json(200, { status: "connected" });
  }

  async function route(request: Request): Promise<Response> {
    const rejected =
      (config.httpAllowedHosts.length === 0
        ? undefined
        : hostHeaderValidationResponse(request, config.httpAllowedHosts)) ??
      (config.httpAllowedOrigins.length === 0
        ? undefined
        : originValidationResponse(request, config.httpAllowedOrigins));
    if (rejected !== undefined) return rejected;

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === "/healthz")
      return json(200, {
        status: "ok",
        mode: config.publicOnly ? "public" : "full",
        activeRequests: gate.active,
      });

    if (url.pathname === "/" && (method === "GET" || method === "HEAD")) {
      const html = await loadIndexHtml();
      if (html === undefined) return notFound(url.pathname);
      return new Response(method === "HEAD" ? null : html, {
        headers: HTML_HEADERS,
      });
    }

    if (url.pathname === "/api/personal/dashboard" && method === "GET") {
      if (config.publicOnly) return notFound(url.pathname);
      return handlePersonalDashboard();
    }
    if (url.pathname === "/api/personal/connect" && method === "POST") {
      if (config.publicOnly) return notFound(url.pathname);
      return handlePersonalConnect();
    }

    const isMcp = url.pathname === "/mcp";
    const isApi = url.pathname.startsWith("/api/");
    if (!isMcp && !isApi) return notFound(url.pathname);

    const decision = (isMcp ? mcpLimiter : apiLimiter).take(clientKey(request));
    if (!decision.allowed) {
      return json(
        429,
        {
          error: {
            code: "RATE_LIMITED",
            message:
              "リクエストが多すぎます。しばらく待ってから再試行してください。",
          },
        },
        { "retry-after": String(decision.retryAfterSeconds) },
      );
    }

    const release = gate.tryAcquire();
    if (release === undefined) {
      return json(
        503,
        {
          error: {
            code: "RATE_LIMITED",
            message: "同時実行数の上限に達しています。少し待ってください。",
          },
        },
        { "retry-after": "5" },
      );
    }

    try {
      if (isMcp) return await mcpHandler.fetch(request);
      if (url.pathname === "/api/syllabi/search" && method === "POST")
        return await handleSearch(request);
      const detail = /^\/api\/syllabi\/([^/]+)$/.exec(url.pathname);
      if (detail !== null && method === "GET")
        return await handleSyllabus(decodeURIComponent(detail[1]!));
      return notFound(url.pathname);
    } finally {
      release();
    }
  }

  return {
    fetch: async (request) => {
      try {
        return await route(request);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return errorResponse(error);
      }
    },
    close: async () => {
      clearInterval(pruneTimer);
      await mcpHandler.close();
    },
  };
}
