// Entry point for hosts that capture a `server` module (Vercel, and any
// platform that runs one long-lived process). Public catalog only: it reads
// the public Web Syllabus over plain HTTP and holds no Waseda session.
import { startPublicCatalogServer } from "./dist/http/public-server.js";

const handle = await startPublicCatalogServer();
console.error(`waseda-portal-mcp public catalog listening on :${handle.port}`);
