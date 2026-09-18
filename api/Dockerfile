FROM node:24.20-alpine AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.27.0 --activate
WORKDIR /workspace

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/package.json
COPY packages/core-eve-projections/package.json ./packages/core-eve-projections/package.json
COPY packages/core-data-contract/package.json ./packages/core-data-contract/package.json
COPY packages/esi-client/package.json ./packages/esi-client/package.json
COPY packages/platform-module-contract/package.json ./packages/platform-module-contract/package.json
COPY packages/platform-module-persistence-policy/package.json ./packages/platform-module-persistence-policy/package.json
COPY packages/platform-module-server/package.json ./packages/platform-module-server/package.json
COPY features ./features
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @eve-space/api...

COPY api/tsconfig.json ./api/tsconfig.json
COPY api/src ./api/src
COPY api/migrations ./api/migrations
COPY packages/core-eve-projections/tsconfig.json ./packages/core-eve-projections/tsconfig.json
COPY packages/core-eve-projections/src ./packages/core-eve-projections/src
COPY packages/core-data-contract/tsconfig.json ./packages/core-data-contract/tsconfig.json
COPY packages/core-data-contract/src ./packages/core-data-contract/src
COPY packages/esi-client/tsconfig.json packages/esi-client/tsdown.config.ts ./packages/esi-client/
COPY packages/esi-client/src ./packages/esi-client/src
COPY packages/esi-client/scripts/check-runtime-imports.ts ./packages/esi-client/scripts/check-runtime-imports.ts
COPY packages/platform-module-contract/tsconfig.json ./packages/platform-module-contract/tsconfig.json
COPY packages/platform-module-contract/src ./packages/platform-module-contract/src
COPY packages/platform-module-contract/bin ./packages/platform-module-contract/bin
COPY packages/platform-module-persistence-policy/tsconfig.json ./packages/platform-module-persistence-policy/tsconfig.json
COPY packages/platform-module-persistence-policy/src ./packages/platform-module-persistence-policy/src
COPY packages/platform-module-server/tsconfig.json ./packages/platform-module-server/tsconfig.json
COPY packages/platform-module-server/src ./packages/platform-module-server/src
COPY scripts/run-installed-module-package-script.ts ./scripts/run-installed-module-package-script.ts
COPY scripts/module-registry ./scripts/module-registry
RUN pnpm --filter @eve-space/api build
RUN pnpm --filter @eve-space/api --prod deploy /prod/api

FROM node:24.20-alpine AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.27.0 --activate
WORKDIR /app

COPY --from=build /prod/api ./

USER node

# The Compose worker service overrides this with start:worker; only the API runs migrations.
CMD ["pnpm", "--config.verify-deps-before-run=false", "start:container"]
