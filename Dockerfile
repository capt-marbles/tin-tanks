# =============================================================================
# Tin Tanks game server image for Gameye
# =============================================================================
# Stage 1 builds the three.js browser client; stage 2 is the slim runtime that
# serves the built client and runs the authoritative WebSocket game server on
# one TCP port.
#
# Build:  docker build -t tin-tanks-claude:local .
# Run:    docker run --rm -p 8080:8080 tin-tanks-claude:local
# Play:   open http://localhost:8080/
#
# Gameye notes
#   - Runs as a non-root user (required by Gameye).
#   - Bridge networking (default): EXPOSE 8080/tcp below tells Gameye which
#     container port to map. Register the application with one TCP port
#     binding on 8080. The session response returns host + host port.
#   - Host networking: set env NETWORK_MODE=host in the session request and
#     the server binds to the port Gameye injects as GAMEYE_PORT_TCP_8080.
#   - Session "args" are appended to the ENTRYPOINT, e.g. ["--port=9000"].
# =============================================================================

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY server server
COPY client client
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist

RUN addgroup -g 10001 -S tanks \
 && adduser -u 10001 -S -G tanks -h /app tanks \
 && chown -R tanks:tanks /app
USER tanks

EXPOSE 8080/tcp

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/health" >/dev/null || exit 1

ENTRYPOINT ["node", "server/src/index.js"]
