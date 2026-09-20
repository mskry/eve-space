# syntax=docker/dockerfile:1.7

FROM node:24.20-alpine AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /workspace

FROM base AS build

ARG NPM_TOKEN

COPY . .
# The steps below build every installed module package, so a filter would omit newer features.
RUN if [ -n "${NPM_TOKEN:-}" ]; then \
      printf '%s\n' "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc; \
    fi \
    && pnpm install --frozen-lockfile --ignore-scripts \
    && rm -f /root/.npmrc
RUN pnpm build:nuxt:dependencies
RUN pnpm registry:check
RUN pnpm --filter @eve-space/api exec tsc
RUN pnpm --config.ignore-scripts=true --filter @eve-space/api --prod deploy /prod/api

FROM node:24.20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /prod/api ./

USER node

# The worker service overrides this command; only the API runs migrations.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
