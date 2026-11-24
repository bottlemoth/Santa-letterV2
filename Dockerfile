# syntax=docker/dockerfile:1

# ---------- Etap 1: zależności produkcyjne ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Etap 2: obraz testowy (pełne zależności + testy) ----------
FROM node:22-alpine AS test
WORKDIR /app
ENV NODE_ENV=test
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY . .
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
CMD ["npm", "test"]

# ---------- Etap 3: obraz produkcyjny ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/uploads \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# tini — poprawna obsługa sygnałów i procesów zombie
RUN apk add --no-cache tini

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/uploads \
 && chown node:node /app/uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/server.js"]
