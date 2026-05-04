# ---------- deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Manifests first so the install layer caches across code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages packages
# We only need the package.json files of the workspace packages for install,
# not their src. But bringing in the whole packages dir is simpler and the
# Docker layer cache keeps it cheap.

RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY apps/web ./apps/web

RUN pnpm --filter @outreach/web build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone output is self-contained — only tracks the deps we actually
# import at runtime. ~50 MB image instead of 500 MB.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Drop privileges
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -s /bin/sh -D nextjs
USER nextjs

EXPOSE 3000

# `next build --output standalone` emits server.js next to apps/web/
CMD ["node", "apps/web/server.js"]
