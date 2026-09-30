# ── Construction : dépendances + interface ─────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 se compile si aucun binaire précompilé ne correspond
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Exécution ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5174 \
    NOVA_DATA_DIR=/app/data
COPY --from=build /app /app
# Base, clés, caches, journaux : tout ce qui doit survivre à une mise à jour
VOLUME /app/data
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:5174/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
