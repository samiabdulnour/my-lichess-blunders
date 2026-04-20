# ── Build stage ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install deps first (better cache)
COPY package*.json ./
RUN npm ci

# Build the Next.js app
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Stockfish: the app spawns `stockfish` via child_process, so the
# binary must be on PATH in the runtime container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends stockfish \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=10000

# Copy only what's needed to run `next start`.
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs

EXPOSE 10000
CMD ["npm","start","--","-p","10000"]
