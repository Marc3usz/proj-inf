# TrackFlow MVP Deployment Guide

This guide describes how to start the TrackFlow MVP completely from scratch with a single command. The entire system is containerized via Docker Compose, including the frontend web app, the backend API, the background worker, and all dependencies (PostgreSQL, Redis, RabbitMQ, and Mailhog).

## Prerequisites

1. **Docker Desktop** or **Docker Engine** (with `docker compose` plugin).
2. Ensure ports `3000` (API), `4173`/`5173` (Web), `5432` (PostgreSQL), `6379` (Redis), `5672`/`15672` (RabbitMQ), and `1025`/`8025` (Mailhog) are available on your host machine.

## Deployment Instructions

To deploy the entire TrackFlow system, open your terminal in the root directory of this project and run:

```bash
# If you are using pnpm:
pnpm run deploy

# Or simply using Docker Compose directly:
docker compose -f infra/docker-compose.yml up -d --build
```

### What this does:
1. Provisions all underlying infrastructure (PostgreSQL, Redis, RabbitMQ, Mailhog).
2. Builds the `api`, `worker`, and `web` images using multi-stage Dockerfiles.
3. Automatically runs database migrations (`npx prisma migrate deploy`).
4. Automatically seeds the database (`npx tsx prisma/seed.ts`) with test users, campaigns, and links.
5. Starts the API on `http://localhost:3000`, the worker in the background, and the Web UI on `http://localhost:5173`.

### Seeded Credentials

You can log in to the system immediately using the following test credentials:

- **Agency Admin:** `admin@test.com` / `test123`
- **Marketer:** `marketer@test.com` / `test123`
- **Client User:** `client@test.com` / `test123`

The database has also been pre-seeded with 5 test campaigns, 5 test links (e.g., `1X2-d4F`), and 100 historical clicks.

## Available Services

Once deployed, the following services will be accessible:

| Service | Local URL | Description |
| :--- | :--- | :--- |
| **Web App** | `http://localhost:5173` | SvelteKit Frontend (Dashboard) |
| **API** | `http://localhost:3000` | Fastify REST API |
| **Redirect Link Example** | `http://localhost:3000/1X2-d4F` | Test redirect path to verify caching / speed |
| **RabbitMQ Management** | `http://localhost:15672` | UI to view RabbitMQ queues (`trackflow`/`trackflow`) |
| **Mailhog Web UI** | `http://localhost:8025` | UI to view sent test emails (e.g., weekly reports) |

## Stopping the System

To gracefully stop and remove the containers while preserving the persistent data volumes:

```bash
# If you are using pnpm:
pnpm run stop

# Or simply using Docker Compose directly:
docker compose -f infra/docker-compose.yml down
```

### Data Persistence

The data for PostgreSQL, Redis, RabbitMQ, and the generated PDF reports are persisted in Docker volumes. When you run `docker compose down`, this data will **not** be deleted. To completely wipe the data and start fresh, run:

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Useful Commands

- View API logs: `docker compose -f infra/docker-compose.yml logs -f api`
- View Worker logs: `docker compose -f infra/docker-compose.yml logs -f worker`
- View Web app logs: `docker compose -f infra/docker-compose.yml logs -f web`