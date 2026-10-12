# Batter Beats production image: the built app plus everything it needs to run
# (Node, ffmpeg, mp3gain). Data lives in /data; mount a volume there.

# ── Build: install everything, build the screens, then drop the build-only tools.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Which build this is (the git commit); shown on phones and used to offer updates.
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION
RUN npm run build && npm prune --omit=dev

# ── Run
FROM node:22-bookworm-slim
ARG APP_VERSION=unknown
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg mp3gain tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    PORT=8090 \
    DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# tini passes stop signals on to Node, so the container shuts down cleanly.
ENTRYPOINT ["tini", "--"]
# Node 22 runs the TypeScript server files directly (type stripping).
CMD ["node", "server/index.ts"]
