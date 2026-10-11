# Build one image per app: docker build --target api|agent-api|web .
#
# Runtime environment:
#   api        API_PORT (default 3001), WEB_ORIGIN, NWS_USER_AGENT,
#              DB_PATH (default under the /app/.data volume)
#   agent-api  AGENT_API_PORT (default 3002), TASKS_API_URL,
#              OPENROUTER_API_KEY and OPENROUTER_MODEL (optional)
#   web        WEB_PORT (default 3000)
# The web target also needs build args WEB_ORIGIN and VITE_API_BASE_URL.
# VITE_API_BASE_URL is compiled into the bundle and must be reachable from
# both the browser and the web container.

# @libsql ships glibc binaries, so the base is Debian slim, not Alpine.
ARG BUN_IMAGE=oven/bun:1.3.14-slim

FROM ${BUN_IMAGE} AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/agent-api/package.json apps/agent-api/
COPY apps/web/package.json apps/web/

FROM manifests AS build
RUN bun install --frozen-lockfile
COPY . .

FROM build AS api-build
RUN bun run build:api

FROM build AS agent-api-build
RUN bun run build:agent-api

FROM build AS web-build
ARG WEB_ORIGIN
ARG VITE_API_BASE_URL
RUN : "${WEB_ORIGIN:?build arg WEB_ORIGIN is required for the web target}" \
  && : "${VITE_API_BASE_URL:?build arg VITE_API_BASE_URL is required for the web target}" \
  && bun run build:web

FROM manifests AS production-deps
RUN bun install --frozen-lockfile --production

# The /app layout mirrors the repository: packages/db resolves DB_PATH and its
# migrations relative to its own source, and the bundles keep packages external.
FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps /app ./

FROM runtime AS api
ENV API_PORT=3001
ENV DB_PATH=/app/.data/closure-call.sqlite
COPY packages/db/src packages/db/src
COPY packages/db/drizzle packages/db/drizzle
COPY packages/db/scripts packages/db/scripts
COPY --from=api-build /app/apps/api/dist apps/api/dist
# Created before VOLUME so a new named volume inherits the bun user's ownership.
RUN mkdir .data && chown bun:bun .data
VOLUME /app/.data
USER bun
EXPOSE ${API_PORT}
CMD ["sh", "-c", "bun packages/db/scripts/migrate.ts && echo 'Migrations applied' && exec bun apps/api/dist/index.js"]

FROM runtime AS agent-api
ENV AGENT_API_PORT=3002
COPY --from=agent-api-build /app/apps/agent-api/dist apps/agent-api/dist
USER bun
EXPOSE ${AGENT_API_PORT}
CMD ["bun", "apps/agent-api/dist/index.js"]

FROM runtime AS web
ENV WEB_PORT=3000
COPY apps/web/serve.ts apps/web/
COPY --from=web-build /app/apps/web/dist apps/web/dist
USER bun
EXPOSE ${WEB_PORT}
CMD ["bun", "apps/web/serve.ts"]
