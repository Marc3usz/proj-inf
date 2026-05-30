FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm db:generate && pnpm --filter @trackflow/shared build && pnpm --filter @trackflow/api build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/prisma prisma
COPY --from=build /app/package.json package.json
COPY package.json pnpm-workspace.yaml ./
CMD ["sh", "-c", "until npx prisma migrate deploy; do echo 'waiting for postgres'; sleep 2; done && npx tsx prisma/seed.ts && node apps/api/dist/server.js"]
