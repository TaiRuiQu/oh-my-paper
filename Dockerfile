FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm run build

FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
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
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/worker ./worker
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tools/python ./tools/python
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts /app/tsconfig.json /app/package.json ./
ENV NODE_ENV=production PYTHON_SANDBOX_VENV=/opt/python-sandbox
USER node
CMD ["node", "--conditions=react-server", "--import", "tsx", "worker/index.ts", "--production"]
