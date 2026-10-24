# Single-service image (API + built React client + Chromium for the WebAuthn benchmark).
# Used by Render (render.yaml) and usable on any Docker host:
#   docker build -t mfa-platform . && docker run -p 4000:4000 --env-file .env -e PORT=4000 mfa-platform

# --- Stage 1: build the React client -------------------------------------------------------
FROM node:22-bookworm-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --include-workspace-root=false --ignore-scripts
COPY client client
RUN npm run build -w client

# --- Stage 2: runtime ------------------------------------------------------------------------
# The Playwright image ships Node.js and the Chromium build matching playwright-core 1.64.1.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
ENV NODE_ENV=production \
    SERVE_CLIENT=true \
    PORT=10000
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --ignore-scripts \
 && npm cache clean --force
COPY server server
COPY --from=client /app/client/dist client/dist
# Writable cache for the auto-created Ethereal test account.
RUN mkdir -p server/.data && chown -R pwuser:pwuser server/.data
USER pwuser
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Seeding is idempotent: creates admin/demo users and protocol definitions on first start only.
CMD ["sh", "-c", "node server/scripts/seed.js && exec node server/src/server.js"]
