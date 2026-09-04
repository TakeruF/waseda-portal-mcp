import { FetchPageReader } from "../adapters/waseda/fetch-page-reader.js";
import { LiveWasedaSources } from "../adapters/waseda/sources.js";
import { WasedaAdapter } from "../adapters/waseda/waseda-adapter.js";
import { loadConfig, type AppConfig } from "../config/config.js";
import { TtlCache } from "../core/cache/ttl-cache.js";
import {
  createNodeApp,
  startHttpServer,
  type HttpServerHandle,
  type NodeApp,
} from "./http-server.js";

/**
 * Builds the public catalog adapter: plain HTTP reads, no browser, no
 * authenticated session, no owner-only local files. Shared by the CLI and by
 * hosts that capture a `server` entrypoint.
 */
export function createPublicCatalogAdapter(config: AppConfig): WasedaAdapter {
  return new WasedaAdapter(
    new LiveWasedaSources(
      new FetchPageReader({ timeoutMs: config.navigationTimeoutMs }),
      new TtlCache(config.cacheEnabled, config.cacheTtlMs),
      {
        minAccessIntervalMs: config.minAccessIntervalMs,
        maxSyllabusCandidates: config.maxSyllabusCandidates,
        maxAssignmentDetails: config.maxAssignmentDetails,
      },
    ),
  );
}

function reportError(error: Error): void {
  console.error(`http error: ${error.message}`);
}

/**
 * Builds the public catalog request handler without binding a port.
 *
 * A captured `server` entrypoint has to call `listen` while its module is
 * still evaluating, so the hosted entry listens first and builds this
 * lazily on the first request.
 */
export function createPublicCatalogHandler(): NodeApp {
  const config = loadConfig({ publicOnly: true });
  return createNodeApp({
    config,
    adapter: createPublicCatalogAdapter(config),
    onError: reportError,
  });
}

export async function startPublicCatalogServer(): Promise<HttpServerHandle> {
  const config = loadConfig({
    publicOnly: true,
    // A captured server entrypoint is reached through the platform's own
    // proxy, so this entry binds every interface unless the operator says
    // otherwise. The empty host means "no host argument", which is what
    // covers IPv6 as well; the `serve-http` CLI keeps loopback as its local
    // default.
    httpHost: process.env.WASEDA_PORTAL_HTTP_HOST ?? "",
  });
  if (!config.publicOnly)
    throw new Error("startPublicCatalogServer requires public-only mode");
  return startHttpServer({
    config,
    adapter: createPublicCatalogAdapter(config),
    onError: reportError,
  });
}
