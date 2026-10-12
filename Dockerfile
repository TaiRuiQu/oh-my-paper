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
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24.19.0-bookworm-slim AS worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils fonts-noto-cjk tesseract-ocr tesseract-ocr-osd python3 python3-sympy ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/worker ./worker
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tools ./tools
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts /app/tsconfig.json /app/package.json ./
ENV NODE_ENV=production
USER node
CMD ["node", "--conditions=react-server", "--import", "tsx", "worker/index.ts", "--production"]
