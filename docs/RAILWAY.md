# Railway Deployment

Deploy TrackFlow as three Railway services from the same repository root. Do not set the service root to `apps/api`, `apps/web`, or `apps/worker`; the Dockerfiles need the monorepo root as build context.

## Services

API service:
- Dockerfile path: `apps/api/Dockerfile`
- Public URL is the redirect host unless you attach a custom short-link domain.
- Runs Prisma migrations and idempotent seed data on startup.

Worker service:
- Dockerfile path: `apps/worker/Dockerfile`
- No public domain required.
- Depends on PostgreSQL, RabbitMQ, SMTP, and the API public URL.

Web service:
- Dockerfile path: `apps/web/Dockerfile`
- Public URL is the SvelteKit dashboard.
- Reads `PUBLIC_API_BASE_URL` at runtime through SvelteKit server load.

## Required Variables

Set these on the API service:

```env
DATABASE_URL=<Railway Postgres URL>
REDIS_URL=<Railway Redis URL>
RABBITMQ_URL=<RabbitMQ URL>
JWT_SECRET=<strong secret>
IP_HASH_SALT=<strong salt>
PUBLIC_SHORT_URL_BASE=https://<api-service-or-short-domain>
APP_BASE_URL=https://<web-service-domain>
CORS_ORIGIN=https://<web-service-domain>
```

Set these on the Worker service:

```env
DATABASE_URL=<Railway Postgres URL>
REDIS_URL=<Railway Redis URL>
RABBITMQ_URL=<RabbitMQ URL>
SMTP_HOST=<smtp host>
SMTP_PORT=<smtp port>
SMTP_USER=<smtp user>
SMTP_PASSWORD=<smtp password>
SMTP_FROM=noreply@trackflow.io
PDF_STORAGE_PATH=/app/storage/reports
GEOIP_API_URL=<geoip provider url>
GEOIP_API_KEY=<geoip key>
GEOIP_TIMEOUT_MS=750
IP_HASH_SALT=<same salt as API>
APP_BASE_URL=https://<web-service-domain>
API_BASE_URL=https://<api-service-or-short-domain>
```

Set these on the Web service:

```env
PUBLIC_API_BASE_URL=https://<api-service-domain>
```

`CORS_ORIGIN` on the API service should be the exact deployed web origin, for example:

```env
CORS_ORIGIN=https://web-production-8d072.up.railway.app
```

For short links, the important value is `PUBLIC_SHORT_URL_BASE` on the API service. It must be the API service origin only, without `/api` at the end.

Correct:

```env
PUBLIC_SHORT_URL_BASE=https://trackflow-api.up.railway.app
```

Incorrect:

```env
PUBLIC_SHORT_URL_BASE=https://trackflow-api.up.railway.app/api
```

Redirects live at the root of the API service, so the working URL format is `https://trackflow-api.up.railway.app/1X2-d4F`, not `https://trackflow-api.up.railway.app/api/1X2-d4F`.

If `PUBLIC_SHORT_URL_BASE` is missing or still set to localhost, the API now falls back to the incoming Railway request host so generated links still use the deployed API domain.
