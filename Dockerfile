# MaintenanceMap in one container: the API, and the built client served from it.
# Everything that must survive a restart lives in /data, which is a mounted volume.

# --- Build the client -------------------------------------------------------
FROM node:22-bookworm-slim AS client
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Build the server -------------------------------------------------------
FROM node:22-bookworm-slim AS server
WORKDIR /build/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate && npm run build

# --- Runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# openssl for Prisma, tar for the nightly archive, tini so signals reach node and
# Ctrl-C / `docker stop` shut the app down cleanly instead of killing it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl tar tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only, then the Prisma client for this platform.
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/prisma ./prisma
RUN npx prisma generate

COPY --from=server /build/server/dist ./dist
COPY --from=client /build/client/dist ./public

# The database, the photos and the backups all live on the volume.
ENV DATABASE_URL=file:/data/maintenancemap.db \
    UPLOADS_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    CLIENT_DIST=/app/public \
    PORT=4000
VOLUME ["/data"]
EXPOSE 4000

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Docker restarts the container if this starts failing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
