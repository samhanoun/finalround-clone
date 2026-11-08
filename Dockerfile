# syntax=docker/dockerfile:1
# Apex Round: Next.js 16 + custom Node server (server.ts) with the STT WebSocket relay.
# Build:  docker build -t apex-round \
#           --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#           --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#           --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com .
# Run:    docker run -p 3000:3000 --env-file .env.production apex-round
# See docs/deploy.md.

ARG NODE_VERSION=22

# --- deps: every dependency, for the build ---
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- prod-deps: production dependencies only, for the runtime image ---
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- build: next build + tsc -p tsconfig.server.json (npm run build does both) ---
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
# they must be passed here and not only at runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BETA_LIVE_COPILOT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BETA_LIVE_COPILOT=$NEXT_PUBLIC_BETA_LIVE_COPILOT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime ---
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
# The container only runs node. The base image's npm, npx, corepack and yarn
# aren't needed, and npm's own bundled dependencies carry known
# vulnerabilities (Trivy's image scan), so they're removed.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# server.ts binds to $HOSTNAME; Docker would otherwise set it to the container id.

# The custom server runs `next start` in-process, so it needs the build output,
# public/, next.config.ts (loaded at startup), package.json and node_modules.
# Translations (src/messages) are bundled into .next by the build.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/.server ./.server

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# server.ts runs in dev mode unless --production is passed (this is what `npm start` does).
CMD ["node", ".server/server.js", "--production"]
