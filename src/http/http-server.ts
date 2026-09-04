import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";

import type { WasedaAdapter } from "../adapters/waseda/waseda-adapter.js";
import type { AppConfig } from "../config/config.js";
import { asPortalError } from "../core/errors/portal-error.js";
import type { PortalErrorCode } from "../core/errors/portal-error.js";
import { syllabusCatalogSearchInputSchema } from "../core/models/inputs.js";
import { createMcpServer } from "../server.js";
import {
  getSyllabusOutputSchema,
  searchSyllabiOutputSchema,
} from "../tools/schemas.js";
import { ConcurrencyGate, TokenBucketRateLimiter } from "./rate-limiter.js";

/**
 * The adapter declares `method`/`url` as optional properties, which
 * `exactOptionalPropertyTypes` refuses to satisfy from Node's own
 * `IncomingMessage` (`string | undefined`). The shapes are otherwise identical.
 */
type McpNodeRequest = Parameters<ReturnType<typeof toNodeHandler>>[0];

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

export interface HttpAppDeps {
  adapter: WasedaAdapter;
  config: AppConfig;
  onError?: (error: Error) => void;
}

export interface HttpApp {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  close: () => Promise<void>;
}

function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first !== undefined && first.length > 0
    ? first
    : (req.socket.remoteAddress ?? "unknown");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  const portalError = asPortalError(error);
  sendJson(res, STATUS_BY_ERROR_CODE[portalError.code] ?? 500, {
    error: {
      code: portalError.code,
      message: portalError.message,
      details: portalError.details ?? {},
    },
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES)
      throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function createHttpApp(deps: HttpAppDeps): Promise<HttpApp> {
  const { adapter, config } = deps;
  const indexHtml = await fs.readFile(
    new URL("../../public/index.html", import.meta.url),
    "utf8",
  );

  const mcpHandler = createMcpHandler(
    () => createMcpServer(adapter, { publicOnly: config.publicOnly }),
    { onerror: deps.onError ?? (() => undefined) },
  );
  const mcpNodeHandler = toNodeHandler(mcpHandler, {
    onerror: deps.onError ?? (() => undefined),
  });

  const apiLimiter = new TokenBucketRateLimiter(config.httpRequestsPerMinute);
  const mcpLimiter = new TokenBucketRateLimiter(
    config.httpRequestsPerMinute * MCP_RATE_MULTIPLIER,
  );
  const gate = new ConcurrencyGate(config.httpMaxConcurrentRequests);
  const pruneTimer = setInterval(() => {
    apiLimiter.prune();
    mcpLimiter.prune();
  }, BUCKET_PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  const validateHost =
    config.httpAllowedHosts.length === 0
      ? undefined
      : hostHeaderValidation(config.httpAllowedHosts);
  const validateOrigin =
    config.httpAllowedOrigins.length === 0
      ? undefined
      : originValidation(config.httpAllowedOrigins);

  async function handleSearch(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const query = syllabusCatalogSearchInputSchema.parse(
      await readJsonBody(req),
    );
    const result = await adapter.searchSyllabi(query);
    sendJson(
      res,
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

  async function handleSyllabus(
    res: ServerResponse,
    syllabusKey: string,
  ): Promise<void> {
    sendJson(
      res,
      200,
      getSyllabusOutputSchema.parse({
        match: await adapter.getSyllabusMatch({ syllabusKey }),
        observedAt: new Date().toISOString(),
      }),
    );
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (validateHost !== undefined && !validateHost(req, res)) return;
    if (validateOrigin !== undefined && !validateOrigin(req, res)) return;

    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();

    if (url.pathname === "/healthz") {
      sendJson(res, 200, {
        status: "ok",
        mode: config.publicOnly ? "public" : "full",
        activeRequests: gate.active,
      });
      return;
    }

    if (url.pathname === "/" && (method === "GET" || method === "HEAD")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'none'; base-uri 'none'",
      });
      res.end(method === "HEAD" ? undefined : indexHtml);
      return;
    }

    const isMcp = url.pathname === "/mcp";
    const isApi = url.pathname.startsWith("/api/");
    if (!isMcp && !isApi) {
      sendJson(res, 404, {
        error: { code: "NOT_FOUND", message: `No route for ${url.pathname}` },
      });
      return;
    }

    const limiter = isMcp ? mcpLimiter : apiLimiter;
    const decision = limiter.take(clientKey(req));
    if (!decision.allowed) {
      sendJson(
        res,
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
      return;
    }

    const release = gate.tryAcquire();
    if (release === undefined) {
      sendJson(
        res,
        503,
        {
          error: {
            code: "RATE_LIMITED",
            message: "同時実行数の上限に達しています。少し待ってください。",
          },
        },
        { "retry-after": "5" },
      );
      return;
    }

    try {
      if (isMcp) {
        await mcpNodeHandler(req as unknown as McpNodeRequest, res);
        return;
      }
      if (url.pathname === "/api/syllabi/search" && method === "POST") {
        await handleSearch(req, res);
        return;
      }
      const detail = /^\/api\/syllabi\/([^/]+)$/.exec(url.pathname);
      if (detail !== null && method === "GET") {
        await handleSyllabus(res, decodeURIComponent(detail[1]!));
        return;
      }
      sendJson(res, 404, {
        error: { code: "NOT_FOUND", message: `No route for ${url.pathname}` },
      });
    } catch (error) {
      deps.onError?.(error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) sendError(res, error);
      else res.end();
    } finally {
      release();
    }
  }

  return {
    handle,
    close: async () => {
      clearInterval(pruneTimer);
      await mcpHandler.close();
    },
  };
}

export interface HttpServerHandle {
  server: Server;
  close: () => Promise<void>;
  port: number;
}

export async function startHttpServer(
  deps: HttpAppDeps,
): Promise<HttpServerHandle> {
  const app = await createHttpApp(deps);
  const server = createServer((req, res) => {
    void app.handle(req, res).catch((error: unknown) => {
      deps.onError?.(error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) sendError(res, error);
      else res.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(deps.config.httpPort, deps.config.httpHost, resolve);
  });
  const address = server.address();
  return {
    server,
    port: typeof address === "object" && address !== null ? address.port : 0,
    close: async () => {
      await app.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
