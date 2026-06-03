# ============================================================================
# nexus-proxy — dev proxy server (Express + http-proxy-middleware)
# Ingen @bimo-dk deps.
# ============================================================================

FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

COPY tsconfig.json proxy-server.ts switch-local.mjs ./

# ============================================================================
# Production runtime — bruger tsx til at koere TS direkte
# ============================================================================
FROM node:22-alpine
RUN apk add --no-cache wget
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/proxy-server.ts /app/switch-local.mjs /app/tsconfig.json ./

EXPOSE 9000

CMD ["npx", "tsx", "proxy-server.ts"]
