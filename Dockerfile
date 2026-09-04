# Public catalog deployment: reads only the public Web Syllabus and academic
# calendar, holds no Waseda session, and serves both /mcp and the tester web UI.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production \
    WASEDA_PORTAL_PUBLIC_ONLY=true \
    WASEDA_PORTAL_HEADLESS=true \
    WASEDA_PORTAL_BROWSER_CHANNEL= \
    WASEDA_PORTAL_HTTP_HOST=0.0.0.0 \
    WASEDA_PORTAL_HTTP_PORT=8787 \
    WASEDA_PORTAL_PROFILE_DIR=/tmp/waseda-portal-mcp/chrome-profile

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

COPY public ./public

USER pwuser
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WASEDA_PORTAL_HTTP_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/cli.js", "serve-http"]
