# syntax=docker/dockerfile:1.7

FROM node:24.20-alpine AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /workspace

FROM base AS build

COPY . .
# The steps below build every installed module package, so a filter would omit newer features.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm build:nuxt:dependencies
RUN pnpm registry:check
RUN pnpm --filter @eve-space/api exec tsc
RUN pnpm --config.ignore-scripts=true --filter @eve-space/api --prod deploy /prod/api

FROM node:24.20-alpine AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

COPY --from=build /prod/api ./

USER node

# The Compose worker service overrides this with start:worker; only the API runs migrations.
CMD ["pnpm", "--config.verify-deps-before-run=false", "start:container"]
