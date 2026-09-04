// Entry point for hosts that capture a `server` module (Vercel, and any
// platform that runs one long-lived process). Public catalog only: it reads
// the public Web Syllabus over plain HTTP and holds no Waseda session.
//
// The port is bound synchronously while this module evaluates, because that
// is what a capturing host watches for. The app itself is built on the first
// request so no await stands between module start and `listen`.
import { createServer } from "node:http";

let app;
let appError;

async function handlerFor(req, res) {
  if (app === undefined && appError === undefined) {
    try {
      const { createPublicCatalogHandler } = await import(
        "./dist/http/public-server.js"
      );
      app = createPublicCatalogHandler();
    } catch (error) {
      appError = error;
    }
  }
  if (appError !== undefined) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          code: "STARTUP_FAILED",
          message: appError?.message ?? String(appError),
        },
      }),
    );
    return;
  }
  await app.handler(req, res);
}

const server = createServer((req, res) => {
  handlerFor(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end();
  });
});

server.listen(Number(process.env.PORT ?? process.env.WASEDA_PORTAL_HTTP_PORT ?? 8787));
