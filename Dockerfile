# Public catalog deployment: reads the public Web Syllabus over plain HTTP,
# holds no Waseda session, and serves both /mcp and the tester web UI.
# No browser is involved, so this is a plain Node image.
FROM node:22-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    WASEDA_PORTAL_PUBLIC_ONLY=true \
    WASEDA_PORTAL_HTTP_HOST=0.0.0.0 \
    WASEDA_PORTAL_HTTP_PORT=8787

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

COPY public ./public
COPY server.mjs ./

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WASEDA_PORTAL_HTTP_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
