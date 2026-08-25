#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { WasedaAdapter } from "./adapters/waseda/waseda-adapter.js";
import { LiveWasedaSources } from "./adapters/waseda/sources.js";
import { runAuth } from "./auth/auth-command.js";
import { BrowserSession } from "./auth/browser-session.js";
import { loadConfig } from "./config/config.js";
import { TtlCache } from "./core/cache/ttl-cache.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noCache = args.includes("--no-cache");
  const command = args.find((arg) => !arg.startsWith("-"));
  const config = loadConfig(noCache ? { cacheEnabled: false } : {});
  if (command === "auth") {
    await runAuth(config);
    return;
  }
  if (command !== undefined) throw new Error(`Unknown command: ${command}`);

  const browser = new BrowserSession(config);
  const cache = new TtlCache(config.cacheEnabled, config.cacheTtlMs);
  const adapter = new WasedaAdapter(new LiveWasedaSources(browser, cache));
  void serveStdio(() => createMcpServer(adapter));
  console.error("waseda-portal-mcp is listening on stdio (read-only)");

  const close = () => {
    void browser.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
