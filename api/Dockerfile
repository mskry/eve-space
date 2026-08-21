FROM node:22.18-alpine AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --filter @eve-space/api...

COPY api/tsconfig.json ./api/tsconfig.json
COPY api/src ./api/src
COPY api/migrations ./api/migrations
RUN pnpm --filter @eve-space/api build
RUN pnpm --filter @eve-space/api --prod deploy /prod/api

FROM node:22.18-alpine AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app

COPY --from=build /prod/api ./

USER node
EXPOSE 8787

CMD ["pnpm", "--config.verify-deps-before-run=false", "start:container"]
