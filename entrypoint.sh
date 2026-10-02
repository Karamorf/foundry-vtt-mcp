#!/bin/sh
set -e

# Wait for MCP backend WebSocket on :31415, then start the Foundry keepalive browser.
# The MCP server (index.bundle.cjs) spawns backend.js which opens that port.
(
  node -e "
    function tryConnect() {
      const net = require('net');
      const s = net.createConnection(31415, '127.0.0.1');
      s.on('connect', function() { s.destroy(); process.exit(0); });
      s.on('error', function() { setTimeout(tryConnect, 500); });
    }
    tryConnect();
  "
  echo "[entrypoint] MCP backend ready, starting Foundry keepalive"
  node /app/foundry-keepalive.js
) &

# MCP server is PID 1 — HTTP/SSE mode, listens on MCP_HTTP_PORT (default 3001)
exec node /app/dist/index.bundle.cjs
