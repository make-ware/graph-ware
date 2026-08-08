# Multi-stage build for Next.js + PocketBase monorepo
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat unzip curl
WORKDIR /app

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Copy package files
COPY package.json yarn.lock .yarnrc.yml* ./
COPY shared/package.json ./shared/
COPY webapp/package.json ./webapp/
COPY cli/package.json ./cli/
# Twice, on purpose. The root package.json declares the workspace as
# `pocketbase`, and `yarn install --immutable` fails outright if that directory
# is missing — it resolves a different workspace set than the lockfile records.
# The runtime path is /app/pb, which is what supervisord and start.sh expect.
COPY pocketbase/package.json ./pocketbase/
COPY pocketbase/package.json ./pb/

# Install dependencies
RUN yarn install --immutable

# Download PocketBase binary
# Fallback only — CI passes --build-arg POCKETBASE_VERSION from .env.example.
ARG POCKETBASE_VERSION=0.39.9
ARG POCKETBASE_ARCH=amd64
RUN mkdir -p /app/pb && \
    curl -L "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${POCKETBASE_ARCH}.zip" \
    -o /tmp/pocketbase.zip && \
    unzip /tmp/pocketbase.zip -d /app/pb && \
    chmod +x /app/pb/pocketbase && \
    rm /tmp/pocketbase.zip

# Build stage
FROM base AS builder
WORKDIR /app

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarn ./.yarn
COPY --from=deps /app/pb/pocketbase ./pb/pocketbase

# Copy workspace files. `shared` is source-only — the webapp compiles its raw
# .ts through `transpilePackages`, so the sources have to be here at build time.
COPY package.json yarn.lock .yarnrc.yml* ./
COPY shared ./shared
COPY webapp ./webapp
COPY cli/package.json ./cli/
COPY pocketbase ./pb
# See the deps stage: `yarn workspace @project/webapp build` resolves the whole
# workspace set, so the declared `pocketbase` directory has to exist here too.
COPY pocketbase/package.json ./pocketbase/

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are inlined into the JS bundle at build time. The PocketBase
# SDK appends "/api/..." to its base URL, so "/" makes browser requests resolve to
# /api/... on the same origin (proxied to PocketBase by nginx). Override at build
# time (--build-arg NEXT_PUBLIC_POCKETBASE_URL=https://api.example.com) to point
# the bundle at an external PocketBase instance.
ARG NEXT_PUBLIC_POCKETBASE_URL=/
ENV NEXT_PUBLIC_POCKETBASE_URL=${NEXT_PUBLIC_POCKETBASE_URL}

RUN yarn workspace @project/webapp build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install supervisor, nginx, and curl
RUN apk add --no-cache supervisor nginx curl

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    adduser nextjs nodejs

# Create directories for supervisor and nginx
RUN mkdir -p /var/log/supervisor /var/run /etc/supervisor/conf.d && \
    mkdir -p /var/log/nginx /var/cache/nginx /var/run/nginx && \
    chown -R nextjs:nodejs /var/log/supervisor /var/run && \
    chown -R nginx:nginx /var/log/nginx /var/cache/nginx /var/run/nginx

# Copy PocketBase binary
COPY --from=builder --chown=nextjs:nodejs /app/pb/pocketbase ./pb/pocketbase

# Copy PocketBase hooks and migrations
COPY --from=builder --chown=nextjs:nodejs /app/pb/pb_hooks ./pb/pb_hooks
COPY --from=builder --chown=nextjs:nodejs /app/pb/pb_migrations ./pb/pb_migrations

# PocketBase launch wrapper — auto-provisions a superuser when admin creds are in
# the env, otherwise falls through to plain `serve` (setup URL printed on first boot).
COPY --chown=nextjs:nodejs docker/pb-entrypoint.sh ./pb/pb-entrypoint.sh
RUN chmod +x ./pb/pb-entrypoint.sh

# Single /data volume holds all runtime state (PocketBase DB, file uploads,
# any future app-level dynamic storage). Bake the directory + ownership in so
# the image runs out-of-the-box without a host mount, and works with one when
# users supply -v $PWD/data:/data.
RUN mkdir -p /data/pb_data && chown -R nextjs:nodejs /data
VOLUME ["/data"]

# Copy package files for workspace resolution
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/yarn.lock ./
COPY --from=builder --chown=nextjs:nodejs /app/.yarnrc.yml ./.yarnrc.yml
COPY --from=builder --chown=nextjs:nodejs /app/.yarn ./.yarn

# Copy workspace package.json files
COPY --from=builder --chown=nextjs:nodejs /app/webapp/package.json ./webapp/
COPY --from=builder --chown=nextjs:nodejs /app/pb/package.json ./pb/

# The whole `shared` workspace, not just its package.json: node_modules below
# carries a `@project/shared` symlink into it, and a dangling symlink breaks
# `next start` even though the sources were already compiled into .next.
COPY --from=builder --chown=nextjs:nodejs /app/shared ./shared

# Install production dependencies only
# Only the root tree. `nodeLinker: node-modules` hoists everything there — the
# per-workspace directories are empty, and the builder never had a
# webapp/node_modules to copy in the first place.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/webapp/.next ./webapp/.next
COPY --from=builder --chown=nextjs:nodejs /app/webapp/public ./webapp/public
COPY --from=builder --chown=nextjs:nodejs /app/webapp/next.config.ts ./webapp/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/webapp/tsconfig.json ./webapp/tsconfig.json

# Copy supervisor and nginx configs
COPY --chown=root:root docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=root:root docker/nginx.conf /etc/nginx/nginx.conf
COPY --chown=nextjs:nodejs docker/start.sh /app/start.sh

# Make startup script executable
RUN chmod +x /app/start.sh

# Create nginx user if it doesn't exist (it should from apk install)
# Ensure nginx can read the config
RUN chmod 644 /etc/nginx/nginx.conf

EXPOSE 80

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1/health || exit 1

# Run as root initially to start supervisor (which will manage processes as appropriate users)
CMD ["/app/start.sh"]
