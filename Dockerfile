FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm run db:generate

FROM dependencies AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "run", "db:deploy"]

FROM dependencies AS build
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm run build

FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates fonts-noto-cjk poppler-utils chromium && rm -rf /var/lib/apt/lists/*
COPY tools/card-scan/requirements.txt /tmp/card-scan-requirements.txt
RUN python3 -m venv /opt/card-scan && /opt/card-scan/bin/pip install --no-cache-dir -r /tmp/card-scan-requirements.txt && rm /tmp/card-scan-requirements.txt
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 CARD_SCAN_PYTHON=/opt/card-scan/bin/python STORAGE_ROOT=/data/storage TEMP_ROOT=/data/tmp CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/tools/card-scan ./tools/card-scan
RUN mkdir -p /data/storage /data/tmp && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM dependencies AS build-ai-worker
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm run build:ai-worker

FROM node:24.19.0-bookworm-slim AS ai-worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates bubblewrap python3 python3-venv util-linux fonts-noto-cjk poppler-utils && rm -rf /var/lib/apt/lists/*
COPY tools/sandbox/requirements.txt /tmp/sandbox-requirements.txt
RUN python3 -m venv /opt/python-sandbox && /opt/python-sandbox/bin/pip install --no-cache-dir -r /tmp/sandbox-requirements.txt && rm /tmp/sandbox-requirements.txt
ENV NODE_ENV=production STORAGE_ROOT=/data/storage TEMP_ROOT=/data/tmp PYTHON_SANDBOX_VENV=/opt/python-sandbox
COPY --from=build-ai-worker --chown=node:node /app/build/ai-worker ./
RUN mkdir -p /data/storage /data/tmp && chown -R node:node /data
USER node
CMD ["node", "--conditions=react-server", "worker.mjs"]
