import { FetchPageReader } from "../adapters/waseda/fetch-page-reader.js";
import { LiveWasedaSources } from "../adapters/waseda/sources.js";
import { WasedaAdapter } from "../adapters/waseda/waseda-adapter.js";
import { loadConfig, type AppConfig } from "../config/config.js";
import { TtlCache } from "../core/cache/ttl-cache.js";
import { startHttpServer, type HttpServerHandle } from "./http-server.js";

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

export async function startPublicCatalogServer(): Promise<HttpServerHandle> {
  const config = loadConfig({ publicOnly: true });
  if (!config.publicOnly)
    throw new Error("startPublicCatalogServer requires public-only mode");
  return startHttpServer({
    config,
    adapter: createPublicCatalogAdapter(config),
    onError: (error) => {
      console.error(`http error: ${error.message}`);
    },
  });
}
