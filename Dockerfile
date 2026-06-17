FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json biome.json ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM oven/bun:1-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/rapids.db

RUN mkdir -p /data && chown bun:bun /data /app

COPY --from=build /app/dist/rapids ./rapids

USER bun

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const port = process.env.PORT || '3000'; fetch('http://127.0.0.1:' + port + '/ready').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./rapids"]
