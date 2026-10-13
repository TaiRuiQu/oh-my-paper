FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .

FROM dependencies AS build
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm run build

FROM dependencies AS worker-build
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm run build:worker

FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 EXPORT_CHROMIUM_PATH=/usr/bin/chromium
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24.19.0-bookworm-slim AS worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils fonts-noto-cjk ca-certificates bubblewrap python3 python3-venv util-linux && rm -rf /var/lib/apt/lists/*
COPY tools/python/requirements.txt /tmp/python-requirements.txt
RUN python3 -m venv /opt/python-sandbox && /opt/python-sandbox/bin/pip install --no-cache-dir -r /tmp/python-requirements.txt && rm /tmp/python-requirements.txt
COPY --from=worker-build --chown=node:node /app/build/worker ./
ENV NODE_ENV=production PYTHON_SANDBOX_VENV=/opt/python-sandbox
USER node
CMD ["node", "--conditions=react-server", "worker/index.mjs", "--production"]
