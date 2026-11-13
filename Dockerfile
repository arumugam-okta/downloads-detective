# Single deployable: the Next.js app, with the Slack bot and SLA timer running inside it (see apps/web/src/instrumentation.ts).
# Base image is the audited wolfi-base pinned by OAP's own Next.js template (apps_build_template).
FROM cgr.dev/chainguard/wolfi-base@sha256:03c6561658909fc4eadd0b2dc717375df40a22cc05455b8f82f1f1974e7e4427 AS build
RUN apk add --no-cache 'nodejs-24>=24.22.1' npm
WORKDIR /app
# Same pnpm version as package.json#packageManager (the lockfile was written by it)
RUN npm install -g pnpm@12.18.0
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @dd/web...
COPY . .
# Build-time placeholders only: the real values are injected at runtime. Nothing here is a secret.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @dd/web build

FROM cgr.dev/chainguard/wolfi-base@sha256:03c6561658909fc4eadd0b2dc717375df40a22cc05455b8f82f1f1974e7e4427
RUN apk add --no-cache 'nodejs-24>=24.22.1' ca-certificates tini
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /app/apps/web/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nonroot:nonroot /app/apps/web/public ./apps/web/public
USER nonroot
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
