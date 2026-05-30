FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm db:generate && pnpm --filter @trackflow/shared build && pnpm --filter @trackflow/worker build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/worker/node_modules apps/worker/node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/prisma prisma
CMD ["sh", "-c", "until npx prisma migrate deploy; do echo 'waiting for postgres'; sleep 2; done && node apps/worker/dist/worker.js"]
