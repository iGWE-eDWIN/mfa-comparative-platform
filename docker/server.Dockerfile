# API + benchmark workers. The Playwright base image ships Node and a Chromium build
# for the WebAuthn virtual authenticator.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --ignore-scripts
COPY server server
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
USER pwuser
CMD ["sh", "-c", "node server/scripts/seed.js && node server/src/server.js"]
