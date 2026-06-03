# Worker / scheduler / migration runner. Runs TypeScript directly via tsx
# for simplicity — startup overhead is negligible, image stays ~150 MB.
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Install full dep tree first (cached layer).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages packages
RUN pnpm install --frozen-lockfile

# Then copy source. Changes to scripts/source bust this layer but not the
# install layer above.
COPY scripts ./scripts
COPY apps ./apps

# Drop privileges
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -s /bin/sh -D worker
USER worker

# Default = run the long-running BullMQ worker. docker-compose overrides
# this `command` for the migration + scheduler entrypoints.
CMD ["pnpm", "worker"]
