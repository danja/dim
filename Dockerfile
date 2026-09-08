# Build stage. The native vector dependency needs a toolchain and BLAS.
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ cmake pkg-config \
      libopenblas-dev libblas-dev liblapack-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime

ARG APP_UID=1001
ARG APP_GID=1001

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini libopenblas0 \
    && rm -rf /var/lib/apt/lists/* \
    && (getent group ${APP_GID} > /dev/null || groupadd --gid ${APP_GID} dim) \
    && (getent passwd ${APP_UID} > /dev/null \
        || useradd --uid ${APP_UID} --gid ${APP_GID} --create-home --shell /bin/false dim)

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=${APP_UID}:${APP_GID} . .

RUN mkdir -p /app/data && chown ${APP_UID}:${APP_GID} /app/data
VOLUME ["/app/data"]

USER ${APP_UID}:${APP_GID}
ENV NODE_OPTIONS=--max-old-space-size=512
ENV PORT=4110
EXPOSE 4110

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4110)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bin/serve.js"]
