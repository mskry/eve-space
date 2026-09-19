# syntax=docker/dockerfile:1.7

FROM node:24.20-alpine AS build

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.27.0 --activate
WORKDIR /workspace

COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm build:nuxt:dependencies
RUN pnpm registry:check
RUN pnpm exec nuxt build

FROM node:24.20-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /workspace/.output ./.output

USER node

CMD ["node", ".output/server/index.mjs"]
