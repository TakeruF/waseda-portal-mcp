#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { WasedaAdapter } from "./adapters/waseda/waseda-adapter.js";
import { FetchPageReader } from "./adapters/waseda/fetch-page-reader.js";
import { LocalSyllabusMappingCache } from "./adapters/waseda/matching/syllabus-mapping-cache.js";
import { LiveWasedaSources } from "./adapters/waseda/sources.js";
import { runAuth } from "./auth/auth-command.js";
import { BrowserSession } from "./auth/browser-session.js";
import { loadConfig, type AppConfig } from "./config/config.js";
import { loadAcademicProfile } from "./config/academic-profile.js";
import { TtlCache } from "./core/cache/ttl-cache.js";
import type { SyllabusPageReader } from "./core/sources/page-access.js";
import { startHttpServer } from "./http/http-server.js";
import { createMcpServer } from "./mcp-server.js";

interface SourceReader {
  reader: SyllabusPageReader;
  close: () => Promise<void>;
}

/**
 * The public catalog is plain HTTP, so a public deployment needs no browser at
 * all. Only the authenticated portals require Playwright.
 */
function createSourceReader(config: AppConfig): SourceReader {
  if (config.publicOnly) {
    return {
      reader: new FetchPageReader({ timeoutMs: config.navigationTimeoutMs }),
      close: () => Promise.resolve(),
    };
  }
  const browser = new BrowserSession(config);
  return { reader: browser, close: () => browser.close() };
}

async function buildAdapter(
  config: AppConfig,
  reader: SyllabusPageReader,
): Promise<WasedaAdapter> {
  const cache = new TtlCache(config.cacheEnabled, config.cacheTtlMs);
  const sources = new LiveWasedaSources(reader, cache, {
    minAccessIntervalMs: config.minAccessIntervalMs,
    ...(config.maxCourses === undefined
      ? {}
      : { maxCourses: config.maxCourses }),
    maxSyllabusCandidates: config.maxSyllabusCandidates,
    maxAssignmentDetails: config.maxAssignmentDetails,
  });
  // A public deployment resolves syllabi by key alone, and the owner-only
  // academic profile never leaves the machine that owns it.
  return config.publicOnly
    ? new WasedaAdapter(sources)
    : new WasedaAdapter(
        sources,
        new LocalSyllabusMappingCache(config.mappingCachePath),
        await loadAcademicProfile(config.academicProfilePath),
      );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith("-"));
  const config = loadConfig({
    ...(args.includes("--no-cache") ? { cacheEnabled: false } : {}),
    ...(args.includes("--public-only") ? { publicOnly: true } : {}),
  });

  if (command === "auth") {
    if (config.publicOnly)
      throw new Error("auth is not available in public-only mode");
    await runAuth(config);
    return;
  }
  if (command !== undefined && command !== "serve-http")
    throw new Error(`Unknown command: ${command}`);

  const source = createSourceReader(config);
  const adapter = await buildAdapter(config, source.reader);
  const mode = config.publicOnly
    ? "public catalog only, no browser"
    : "authenticated";

  if (command === "serve-http") {
    if (
      !config.publicOnly &&
      !["127.0.0.1", "::1", "localhost"].includes(config.httpHost)
    )
      throw new Error(
        "Authenticated Web UI must bind to loopback only. Use --public-only for a shared deployment.",
      );
    const http = await startHttpServer({
      adapter,
      config,
      ...(config.publicOnly
        ? {}
        : {
            connectPersonalSession: async () => {
              // BrowserSession may already have opened the same dedicated
              // profile to report AUTH_REQUIRED. Release that lock before the
              // visible, owner-controlled authentication flow starts.
              await source.close();
              await runAuth(config);
            },
          }),
      onError: (error) => {
        console.error(`http error: ${error.message}`);
      },
    });
    const origin = `http://${config.httpHost}:${http.port}`;
    console.error(
      `waseda-portal-mcp is listening on ${origin} (read-only, ${mode})`,
    );
    console.error(`  MCP endpoint: ${origin}/mcp`);
    console.error(`  Web UI:       ${origin}/`);
    if (!config.publicOnly)
      console.error(
        "  WARNING: this process holds an authenticated Waseda session. Do not expose it to other people; use --public-only for a shared deployment.",
      );
    const shutdown = () => {
      void http
        .close()
        .catch(() => undefined)
        .finally(() => {
          void source.close().finally(() => process.exit(0));
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  void serveStdio(() =>
    createMcpServer(adapter, { publicOnly: config.publicOnly }),
  );
  console.error(`waseda-portal-mcp is listening on stdio (read-only, ${mode})`);

  const close = () => {
    void source.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
