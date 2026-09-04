import { createServer, type Server } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";

import { createFetchApp, type FetchAppDeps } from "./app.js";

export type { FetchAppDeps as HttpAppDeps } from "./app.js";

/**
 * The adapter declares `method`/`url` as optional properties, which
 * `exactOptionalPropertyTypes` refuses to satisfy from Node's own
 * `IncomingMessage` (`string | undefined`). The shapes are otherwise identical.
 */
type NodeRequestLike = Parameters<ReturnType<typeof toNodeHandler>>[0];

export interface HttpServerHandle {
  server: Server;
  close: () => Promise<void>;
  port: number;
}

/**
 * Mounts the shared fetch app on a plain Node server. `toNodeHandler` accepts
 * any `{ fetch }`, so the same routing serves stdio-adjacent local runs and
 * container deployments.
 */
export async function startHttpServer(
  deps: FetchAppDeps,
): Promise<HttpServerHandle> {
  const app = createFetchApp(deps);
  const handler = toNodeHandler(app, {
    onerror: (error) => {
      deps.onError?.(error);
    },
  });
  const server = createServer((req, res) => {
    void handler(req as unknown as NodeRequestLike, res).catch(
      (error: unknown) => {
        deps.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        if (!res.headersSent)
          res.writeHead(500, { "content-type": "text/plain" });
        res.end();
      },
    );
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
