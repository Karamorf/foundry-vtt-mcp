FROM node:20-slim AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package*.json ./
COPY tsconfig.json ./
COPY shared/package.json ./shared/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/foundry-module/package.json ./packages/foundry-module/

RUN npm ci

# Copy source and build self-contained bundles
COPY shared/ ./shared/
COPY packages/mcp-server/ ./packages/mcp-server/
RUN npm run build:shared && npm run bundle:server

# Runtime image
FROM node:20-slim
WORKDIR /app

# Install Playwright + Chromium with all system dependencies
ENV PLAYWRIGHT_DOWNLOAD_TIMEOUT=180000
RUN npm install playwright
RUN npx playwright install chromium --with-deps
RUN npm cache clean --force

COPY --from=builder /app/packages/mcp-server/dist/index.bundle.cjs ./dist/
COPY --from=builder /app/packages/mcp-server/dist/backend.bundle.cjs ./dist/
COPY foundry-keepalive.js ./
COPY entrypoint.sh ./
RUN chmod +x /app/entrypoint.sh

# 3001  = MCP HTTP/SSE endpoint (clients connect here)
# 31415 = WebSocket server (Foundry module connects here, internal)
# 31416 = WebRTC signaling server (internal)
EXPOSE 3001 31415 31416

# Runtime env vars — supply at docker run or via compose, never hardcode
# MCP_TRANSPORT=http  MCP_HTTP_PORT=3001
# FOUNDRY_URL  FOUNDRY_MCP_USERNAME  FOUNDRY_MCP_PASSWORD

ENTRYPOINT ["/app/entrypoint.sh"]
