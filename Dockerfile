# syntax=docker/dockerfile:1

# DBee — multi-stage sobre oven/bun (DBee.md §8).
# Imagem base debian (não alpine) de propósito: `bun build --compile
# --target bun-linux-x64` gera binário glibc, e o runtime é debian-slim.

# ---------- deps ----------
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
WORKDIR /app
COPY . .
# web primeiro (Vite), depois o binário do server
RUN bun run --filter '@dbee/web' build \
 && bun build apps/server/src/index.ts \
      --compile \
      --target bun-linux-x64 \
      --outfile /tmp/dbee

# ---------- runtime ----------
# Sem Bun instalado: só o binário e os assets (DBee.md §8).
FROM debian:12-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home --home-dir /home/dbee dbee

WORKDIR /app
# --chown no próprio COPY: um `chown -R` depois duplicaria a camada inteira do
# binário (+94 MB na imagem, medido).
COPY --from=build --chown=dbee:dbee /tmp/dbee /app/dbee
COPY --from=build --chown=dbee:dbee /app/apps/web/dist /app/public

# volume de dados (SQLite) — DBee.md §8
RUN install -d -o dbee -g dbee /data
VOLUME ["/data"]

USER dbee
ENV NODE_ENV=production \
    PORT=3001 \
    DBEE_DATA_DIR=/data
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/app/dbee"]
