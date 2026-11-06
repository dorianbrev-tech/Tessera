# One image for both the web app and the worker. The Playwright base image ships the
# Chromium build that matches the pinned playwright-core version (1.63.0).
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-monaco.mjs scripts/copy-monaco.mjs
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
# Web by default; the worker service overrides the command with `npm run worker`.
CMD ["npm", "run", "start:web"]
