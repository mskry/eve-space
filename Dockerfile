FROM node:22.18-alpine AS build

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm build

FROM node:22.18-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /workspace/.output ./.output

USER node

CMD ["node", ".output/server/index.mjs"]
