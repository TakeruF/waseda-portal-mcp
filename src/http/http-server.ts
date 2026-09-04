import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

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
export interface NodeApp {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Builds the Node request handler without binding a port, so a host that wants
 * to listen first and construct later can do so.
 */
export function createNodeApp(deps: FetchAppDeps): NodeApp {
  const app = createFetchApp(deps);
  const handler = toNodeHandler(app, {
    onerror: (error) => {
      deps.onError?.(error);
    },
  });
  return {
    handler: (req, res) =>
      handler(req as unknown as NodeRequestLike, res).catch(
        (error: unknown) => {
          deps.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
          if (!res.headersSent)
            res.writeHead(500, { "content-type": "text/plain" });
          res.end();
        },
      ),
    close: app.close,
  };
}

export async function startHttpServer(
  deps: FetchAppDeps,
): Promise<HttpServerHandle> {
  const app = createNodeApp(deps);
  const server = createServer((req, res) => {
    void app.handler(req, res);
  });
  await new Promise<void>((resolve) => {
    // An empty host binds every interface the way `listen(port)` does, which
    // includes IPv6. Naming "0.0.0.0" would bind IPv4 only, and a platform
    // proxy that dials the loopback over IPv6 then never connects.
    if (deps.config.httpHost === "")
      server.listen(deps.config.httpPort, resolve);
    else server.listen(deps.config.httpPort, deps.config.httpHost, resolve);
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
