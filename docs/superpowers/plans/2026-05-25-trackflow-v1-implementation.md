# TrackFlow v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TrackFlow v1 as a Docker Compose deployable TypeScript/Fastify/SvelteKit system matching the approved architecture and contracts.

**Architecture:** Use a TypeScript monorepo with shared packages for config, contracts, auth, queue, and analytics. Fastify API owns auth, tenancy, CRUD, stats, redirect, RabbitMQ publish confirms, and PostgreSQL outbox fallback; worker owns click processing, external GeoIP, full device analytics, PDF generation, notifications, cron jobs, and outbox relay; SvelteKit owns the web UI.

**Tech Stack:** Node.js, TypeScript, pnpm workspaces, Fastify, Prisma, PostgreSQL, Redis, RabbitMQ, SvelteKit, Vitest, Nodemailer, ua-parser-js, Playwright/Puppeteer for PDF, Docker Compose.

---

## File Structure

Create this structure unless an implementation task has already created it:

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
.env.example
apps/api/
  Dockerfile
  package.json
  tsconfig.json
  src/main.ts
  src/app.ts
  src/plugins/config.ts
  src/plugins/prisma.ts
  src/plugins/redis.ts
  src/plugins/rabbitmq.ts
  src/plugins/auth.ts
  src/modules/auth/routes.ts
  src/modules/agencies/routes.ts
  src/modules/users/routes.ts
  src/modules/clients/routes.ts
  src/modules/campaigns/routes.ts
  src/modules/links/routes.ts
  src/modules/redirect/routes.ts
  src/modules/reports/routes.ts
  src/modules/stats/routes.ts
  src/modules/events/publisher.ts
  src/modules/events/outbox.ts
  src/modules/tenancy/guards.ts
  src/test/app.ts
apps/worker/
  Dockerfile
  package.json
  tsconfig.json
  src/main.ts
  src/config.ts
  src/queue/rabbitmq.ts
  src/queue/consumers.ts
  src/queue/outboxRelay.ts
  src/clicks/handleClickRecorded.ts
  src/analytics/userAgent.ts
  src/analytics/referrer.ts
  src/geo/provider.ts
  src/reports/handleReportRequested.ts
  src/reports/pdf.ts
  src/notifications/handleNotificationSend.ts
  src/cron/weeklyReport.ts
  src/cron/noClickAlerts.ts
apps/web/
  Dockerfile
  package.json
  tsconfig.json
  svelte.config.js
  src/routes/+layout.svelte
  src/routes/login/+page.svelte
  src/routes/password-reset/+page.svelte
  src/routes/dashboard/+page.svelte
  src/routes/clients/+page.svelte
  src/routes/campaigns/+page.svelte
  src/routes/links/+page.svelte
  src/routes/links/[id]/+page.svelte
  src/routes/reports/+page.svelte
  src/routes/users/+page.svelte
  src/lib/api.ts
  src/lib/session.ts
packages/shared/
  package.json
  tsconfig.json
  src/config.ts
  src/contracts/events.ts
  src/contracts/api.ts
  src/ids/shortCode.ts
  src/time/week.ts
  src/security/hash.ts
  src/testing/factories.ts
packages/db/
  package.json
  prisma/schema.prisma
  prisma/seed.ts
  src/client.ts
tests/integration/
  click-recorded.test.ts
  redirect-outbox.test.ts
  reports.test.ts
  cron.test.ts
```

## Commands

Use these commands throughout implementation:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @trackflow/db prisma migrate dev
pnpm --filter @trackflow/db prisma db seed
docker compose -f infra/docker-compose.yml config
docker compose -f infra/docker-compose.yml up --build
```

Because the current folder is not a git repository, commit steps are conditional. If `git status` reports a repository, commit at the end of each task. If it reports `not a git repository`, skip the commit step and continue.

---

### Task 1: Monorepo Foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/config.ts`
- Create: `packages/shared/src/contracts/events.ts`
- Create: `packages/shared/src/contracts/api.ts`
- Create: `packages/shared/src/ids/shortCode.ts`
- Create: `packages/shared/src/time/week.ts`
- Create: `packages/shared/src/security/hash.ts`
- Create: `packages/shared/src/testing/factories.ts`

- [ ] **Step 1: Create workspace files**

Create `package.json`:

```json
{
  "name": "trackflow",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "dev": "pnpm -r --parallel dev"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tests/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Create `.env.example` with all required variables:

```env
DATABASE_URL=postgresql://trackflow:trackflow@postgres:5432/trackflow
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://trackflow:trackflow@rabbitmq:5672
JWT_SECRET=change-me-in-prod
IP_HASH_SALT=change-me-in-prod
SMTP_HOST=mailhog
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@trackflow.io
PDF_STORAGE_PATH=/app/storage/reports
GEOIP_PROVIDER=generic
GEOIP_API_URL=https://example-geoip-provider.local/lookup
GEOIP_API_KEY=
GEOIP_TIMEOUT_MS=750
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000
PUBLIC_SHORT_URL_BASE=http://localhost:3000
PUBLIC_API_BASE_URL=http://localhost:3000
```

- [ ] **Step 2: Create shared package manifest and config helper**

Create `packages/shared/package.json`:

```json
{
  "name": "@trackflow/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `packages/shared/src/config.ts`:

```ts
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  IP_HASH_SALT: z.string().min(8),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().email(),
  PDF_STORAGE_PATH: z.string().min(1),
  GEOIP_PROVIDER: z.string().min(1),
  GEOIP_API_URL: z.string().url(),
  GEOIP_API_KEY: z.string().optional().default(''),
  GEOIP_TIMEOUT_MS: z.coerce.number().int().positive().default(750),
  APP_BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  PUBLIC_SHORT_URL_BASE: z.string().url().optional(),
  PUBLIC_API_BASE_URL: z.string().url().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(input);
}
```

- [ ] **Step 3: Create shared event contracts**

Create `packages/shared/src/contracts/events.ts`:

```ts
export type EventType = 'click.recorded' | 'report.requested' | 'notification.send';

export type EventEnvelope<T extends EventType, P> = {
  event_id: string;
  event_type: T;
  version: '1.0';
  timestamp: string;
  payload: P;
};

export type ClickRecordedPayload = {
  agency_id: string;
  client_id: string;
  campaign_id: string;
  link_id: string;
  short_code: string;
  clicked_at: string;
  ip_address: string;
  user_agent: string;
  referrer: string | null;
};

export type ReportRequestedPayload = {
  report_id: string;
  agency_id: string;
  client_id: string;
  requested_by: string | null;
  type: 'manual' | 'weekly';
  date_from: string;
  date_to: string;
  link_ids: string[];
};

export type NotificationSendPayload = {
  type: 'report_ready' | 'alert_no_clicks' | 'weekly_report' | 'password_reset_request';
  agency_id: string;
  client_id: string | null;
  recipient_email: string;
  subject: string;
  template_data: {
    report_id: string | null;
    link_id: string | null;
    short_code: string | null;
    client_name: string | null;
    campaign_name: string | null;
    requesting_user_email: string | null;
    download_url: string | null;
  };
};
```

- [ ] **Step 4: Add short code, week, and hash utilities with tests**

Create `packages/shared/src/ids/shortCode.ts`:

```ts
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateShortCode(random = Math.random): string {
  const char = () => alphabet[Math.floor(random() * alphabet.length)] ?? '0';
  return `${char()}${char()}${char()}-${char()}${char()}${char()}`;
}

export function isShortCode(value: string): boolean {
  return /^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$/.test(value);
}
```

Create `packages/shared/src/security/hash.ts`:

```ts
import { createHash } from 'node:crypto';

export function saltedSha256(value: string | null | undefined, salt: string): string | null {
  if (!value) return null;
  return createHash('sha256').update(salt).update(':').update(value).digest('hex');
}
```

Create `packages/shared/src/time/week.ts`:

```ts
export type WeekRange = { date_from: Date; date_to: Date };

export function previousFullWeekWarsaw(now: Date): WeekRange {
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
  const day = local.getDay() === 0 ? 7 : local.getDay();
  const thisMonday = new Date(local);
  thisMonday.setDate(local.getDate() - day + 1);
  thisMonday.setHours(0, 0, 0, 0);
  const previousMonday = new Date(thisMonday);
  previousMonday.setDate(thisMonday.getDate() - 7);
  const previousSundayEnd = new Date(thisMonday);
  previousSundayEnd.setMilliseconds(-1);
  return { date_from: previousMonday, date_to: previousSundayEnd };
}
```

Create `packages/shared/src/ids/shortCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateShortCode, isShortCode } from './shortCode.js';

describe('short codes', () => {
  it('generates XXX-XXX Base62 codes', () => {
    const code = generateShortCode(() => 0.5);
    expect(code).toMatch(/^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$/);
    expect(isShortCode('1X2-d4F')).toBe(true);
    expect(isShortCode('bad')).toBe(false);
  });
});
```

- [ ] **Step 5: Verify foundation**

Run: `pnpm install && pnpm --filter @trackflow/shared test && pnpm --filter @trackflow/shared typecheck`

Expected: shared tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .env.example packages/shared
git commit -m "chore: initialize TrackFlow monorepo"
```

---

### Task 2: Prisma Data Model, Migrations, and Seed

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/seed.ts`
- Create: `packages/db/src/client.ts`
- Modify: `package.json`

- [ ] **Step 1: Create db package manifest**

Create `packages/db/package.json`:

```json
{
  "name": "@trackflow/db",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "prisma": "prisma",
    "migrate": "prisma migrate dev",
    "generate": "prisma generate",
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.18.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "prisma": "^5.18.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts"]
}
```

- [ ] **Step 2: Create Prisma schema matching DATA_MODEL.md**

Create `packages/db/prisma/schema.prisma` with models: `Agency`, `User`, `Client`, `Campaign`, `Link`, `Click`, `Report`, `AlertDelivery`, `EventOutbox`. Use PostgreSQL enums for roles/status fields. Include these critical indexes:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  agency_admin
  marketer
  client
}

enum CampaignStatus {
  active
  paused
  archived
}

enum LinkStatus {
  active
  inactive
}

enum ReportStatus {
  pending
  processing
  done
  failed
}

enum ReportType {
  manual
  weekly
}

enum OutboxStatus {
  pending
  published
  failed
}

model Agency {
  id        String    @id @default(uuid()) @db.Uuid
  name      String
  slug      String    @unique
  timezone  String    @default("Europe/Warsaw")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz
  users     User[]
  clients   Client[]
  campaigns Campaign[]
  links     Link[]
  reports   Report[]

  @@map("agencies")
}

model User {
  id           String    @id @default(uuid()) @db.Uuid
  agencyId     String    @map("agency_id") @db.Uuid
  clientId     String?   @map("client_id") @db.Uuid
  email        String
  passwordHash String    @map("password_hash")
  role         UserRole
  name         String?
  isActive     Boolean   @default(true) @map("is_active")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz
  agency       Agency    @relation(fields: [agencyId], references: [id])
  client       Client?   @relation(fields: [clientId], references: [id])

  @@unique([agencyId, email])
  @@index([agencyId, role])
  @@map("users")
}
```

Continue the schema with the remaining models and the exact fields from `docs/architecture/DATA_MODEL.md`. Add raw SQL check constraints in the migration after Prisma creates it: short code regex, link expiry <= 365 days, and role/client_id consistency.

- [ ] **Step 3: Generate migration and add constraints**

Run: `pnpm --filter @trackflow/db prisma migrate dev --name init`

Open generated migration and append:

```sql
ALTER TABLE "users" ADD CONSTRAINT "users_role_client_id_check"
CHECK (("role" = 'client' AND "client_id" IS NOT NULL) OR ("role" IN ('agency_admin', 'marketer') AND "client_id" IS NULL));

ALTER TABLE "links" ADD CONSTRAINT "links_short_code_format_check"
CHECK ("short_code" ~ '^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$');

ALTER TABLE "links" ADD CONSTRAINT "links_expires_at_max_365_days_check"
CHECK ("expires_at" <= "created_at" + interval '365 days');
```

Run: `pnpm --filter @trackflow/db prisma migrate reset`

Expected: migration applies without SQL errors.

- [ ] **Step 4: Create Prisma client export**

Create `packages/db/src/client.ts`:

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type { PrismaClient } from '@prisma/client';
```

- [ ] **Step 5: Create seed data**

Create `packages/db/prisma/seed.ts` that creates:

```ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('test123', 10);
  const agency = await prisma.agency.upsert({
    where: { slug: 'trackflow-beta' },
    update: {},
    create: { name: 'TrackFlow Beta Agency', slug: 'trackflow-beta', timezone: 'Europe/Warsaw' }
  });

  const clientA = await prisma.client.create({ data: { agencyId: agency.id, name: 'Acme Retail' } });
  const clientB = await prisma.client.create({ data: { agencyId: agency.id, name: 'Northwind Finance' } });
  const clientC = await prisma.client.create({ data: { agencyId: agency.id, name: 'BluePeak SaaS' } });

  await prisma.user.createMany({
    data: [
      { agencyId: agency.id, email: 'admin@test.com', passwordHash, role: 'agency_admin', name: 'Admin' },
      { agencyId: agency.id, email: 'marketer@test.com', passwordHash, role: 'marketer', name: 'Marketer' },
      { agencyId: agency.id, clientId: clientA.id, email: 'client@test.com', passwordHash, role: 'client', name: 'Client User' }
    ],
    skipDuplicates: true
  });

  const marketer = await prisma.user.findFirstOrThrow({ where: { agencyId: agency.id, email: 'marketer@test.com' } });
  const clients = [clientA, clientB, clientC];
  const codes = ['1X2-d4F', 'Aa1-Bb2', 'C3d-E4f', 'G5h-I6j', 'K7l-M8n'];

  for (let i = 0; i < 5; i += 1) {
    const client = clients[i % clients.length]!;
    const campaign = await prisma.campaign.create({
      data: { agencyId: agency.id, clientId: client.id, name: `Campaign ${i + 1}`, status: 'active', createdBy: marketer.id }
    });
    const link = await prisma.link.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        campaignId: campaign.id,
        shortCode: codes[i]!,
        originalUrl: `https://example.com/landing-${i + 1}?utm_source=seed&utm_medium=email&utm_campaign=campaign-${i + 1}`,
        status: 'active',
        createdBy: marketer.id,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      }
    });
    for (let c = 0; c < 20; c += 1) {
      await prisma.click.create({
        data: {
          eventId: crypto.randomUUID(),
          agencyId: agency.id,
          clientId: client.id,
          campaignId: campaign.id,
          linkId: link.id,
          shortCode: link.shortCode,
          clickedAt: new Date(Date.now() - c * 6 * 60 * 60 * 1000),
          country: 'PL',
          city: 'Warsaw',
          deviceType: c % 2 === 0 ? 'mobile' : 'desktop',
          browser: 'Chrome',
          os: c % 2 === 0 ? 'iOS' : 'Windows',
          referrerDomain: 'example-referrer.com',
          ipHash: `seed-ip-${i}-${c}`,
          userAgentHash: `seed-ua-${i}-${c}`
        }
      });
    }
  }
}

main().finally(async () => prisma.$disconnect());
```

- [ ] **Step 6: Verify database task**

Run: `docker compose -f infra/docker-compose.yml up -d postgres`

Run: `pnpm --filter @trackflow/db prisma migrate reset --force && pnpm --filter @trackflow/db seed`

Expected: seed creates 1 agency, 3 users, 3 clients, 5 campaigns, 5 links, 100 clicks.

- [ ] **Step 7: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add packages/db package.json
git commit -m "feat: add Prisma data model and seed"
```

---

### Task 3: API Application Shell, Auth, Tenancy, and RBAC

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/plugins/config.ts`
- Create: `apps/api/src/plugins/prisma.ts`
- Create: `apps/api/src/plugins/auth.ts`
- Create: `apps/api/src/modules/tenancy/guards.ts`
- Create: `apps/api/src/modules/auth/routes.ts`
- Create: `apps/api/src/test/app.ts`

- [ ] **Step 1: Create API package manifest**

Create `apps/api/package.json`:

```json
{
  "name": "@trackflow/api",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "@fastify/jwt": "^8.0.1",
    "@fastify/sensible": "^5.6.0",
    "@trackflow/db": "workspace:*",
    "@trackflow/shared": "workspace:*",
    "bcryptjs": "^2.4.3",
    "fastify": "^4.28.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Create `apps/api/tsconfig.json` extending root config with `rootDir: src`, `outDir: dist`.

- [ ] **Step 2: Build Fastify app shell**

Create `apps/api/src/app.ts`:

```ts
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { authRoutes } from './modules/auth/routes.js';
import { configPlugin } from './plugins/config.js';
import { prismaPlugin } from './plugins/prisma.js';
import { authPlugin } from './plugins/auth.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(sensible);
  await app.register(cors, { origin: true });
  await app.register(configPlugin);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes);
  app.get('/health', async () => ({ ok: true }));
  return app;
}
```

Create `apps/api/src/main.ts`:

```ts
import { buildApp } from './app.js';

const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
```

- [ ] **Step 3: Add config, prisma, and auth plugins**

Implement `configPlugin` using `parseEnv`, `prismaPlugin` using `new PrismaClient()`, and `authPlugin` using Fastify JWT. Add Fastify type augmentation for `app.config`, `app.prisma`, and `request.user` payload containing `id`, `agency_id`, `client_id`, `role`, `email`.

- [ ] **Step 4: Write auth tests first**

Create `apps/api/src/modules/auth/routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('auth routes', () => {
  it('rejects invalid credentials', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'missing@test.com', password: 'bad' } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});
```

Run: `pnpm --filter @trackflow/api test`

Expected: fails until auth route exists.

- [ ] **Step 5: Implement auth routes**

Create `apps/api/src/modules/auth/routes.ts` with `POST /auth/login` and `POST /auth/password-reset-request`. Login checks active, non-deleted user by email, verifies bcrypt, returns JWT and user. Password reset request always returns 202; if user exists, publish `notification.send` to admins once queue publisher exists; before Task 6, create a pending outbox event using `event_outbox` so behavior is durable.

- [ ] **Step 6: Implement tenancy guards**

Create `apps/api/src/modules/tenancy/guards.ts`:

```ts
export function hasRole(role: string, allowed: string[]): boolean {
  return allowed.includes(role);
}

export function canAccessClient(user: { role: string; client_id: string | null }, clientId: string): boolean {
  if (user.role === 'client') return user.client_id === clientId;
  return user.role === 'agency_admin' || user.role === 'marketer';
}
```

- [ ] **Step 7: Verify API shell**

Run: `pnpm --filter @trackflow/api test && pnpm --filter @trackflow/api typecheck`

Expected: auth tests pass and typecheck succeeds.

- [ ] **Step 8: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/api
git commit -m "feat: add API auth and tenancy shell"
```

---

### Task 4: RabbitMQ Publisher, Redis, Redirect, and Outbox Fallback

**Files:**
- Create: `apps/api/src/plugins/redis.ts`
- Create: `apps/api/src/plugins/rabbitmq.ts`
- Create: `apps/api/src/modules/events/publisher.ts`
- Create: `apps/api/src/modules/events/outbox.ts`
- Create: `apps/api/src/modules/redirect/routes.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write redirect behavior tests**

Create `apps/api/src/modules/redirect/routes.test.ts` with tests for:

```ts
import { describe, expect, it } from 'vitest';

describe('redirect', () => {
  it('returns text 404 for invalid short code', async () => {
    const app = await import('../../app.js').then((m) => m.buildApp());
    const response = await app.inject({ method: 'GET', url: '/bad' });
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('Link not found');
    expect(response.headers['content-type']).toContain('text/plain');
  });
});
```

Run: `pnpm --filter @trackflow/api test`

Expected: fails until redirect route is registered.

- [ ] **Step 2: Implement Redis plugin**

Use `ioredis`. Add dependency to `apps/api/package.json`: `"ioredis": "^5.4.1"`. Plugin exposes `app.redis` with graceful degraded behavior if Redis is unavailable.

- [ ] **Step 3: Implement RabbitMQ publisher**

Use `amqplib`. Add dependency: `"amqplib": "^0.10.4"` and `"@types/amqplib": "^0.10.5"`. Create confirm channel, durable exchange `trackflow.events`, and publish persistent messages.

Expose:

```ts
export async function publishEventWithConfirm(app: FastifyInstance, routingKey: string, envelope: unknown, timeoutMs: number): Promise<boolean>;
```

Return `false` on timeout/error; do not throw into redirect handler.

- [ ] **Step 4: Implement outbox insert**

Create `apps/api/src/modules/events/outbox.ts`:

```ts
export async function writeOutbox(app: FastifyInstance, eventId: string, eventType: string, envelope: unknown): Promise<void> {
  await app.prisma.eventOutbox.create({
    data: { eventId, eventType, payload: envelope as object, status: 'pending' }
  });
}
```

- [ ] **Step 5: Implement redirect route**

Create `apps/api/src/modules/redirect/routes.ts`. Behavior:

- Validate `short_code` format.
- Redis key: `redirect:${shortCode}`.
- Cache value contains `link_id`, `agency_id`, `client_id`, `campaign_id`, `original_url`, `expires_at`, `status`, `campaign_status`, `created_by`.
- On cache miss, query PostgreSQL by `shortCode` including campaign status and deleted flags.
- Negative cache invalid/missing links for 60 seconds.
- Active links publish `click.recorded` with raw IP, raw UA, referrer.
- Try RabbitMQ confirm with dynamic budget starting at 20ms; on failure write outbox with remaining budget; return `302` regardless if link is valid.

- [ ] **Step 6: Register redirect after API routes**

Modify `apps/api/src/app.ts` to register application APIs first and public redirect route last, so `/api/*` and `/auth/*` are not captured as short codes.

- [ ] **Step 7: Verify redirect task**

Run: `pnpm --filter @trackflow/api test && pnpm --filter @trackflow/api typecheck`

Run after Docker services are available: `curl -o /dev/null -s -w "Total: %{time_total}s\n" http://localhost:3000/1X2-d4F`

Expected: redirect returns 302 and total time under `0.080s` in normal local conditions.

- [ ] **Step 8: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/api
git commit -m "feat: add fast redirect with queue and outbox fallback"
```

---

### Task 5: CRUD APIs for Agencies, Users, Clients, Campaigns, and Links

**Files:**
- Create: `apps/api/src/modules/agencies/routes.ts`
- Create: `apps/api/src/modules/users/routes.ts`
- Create: `apps/api/src/modules/clients/routes.ts`
- Create: `apps/api/src/modules/campaigns/routes.ts`
- Create: `apps/api/src/modules/links/routes.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write RBAC tests for client isolation**

Create tests asserting a `client` role cannot access another client's links or reports and a `marketer` can access all clients in the agency. Use Fastify injection with signed JWTs.

- [ ] **Step 2: Implement `/api/agencies/current`**

Add GET for all authenticated roles and PATCH for `agency_admin` only. Always filter by `request.user.agency_id`.

- [ ] **Step 3: Implement `/api/users`**

Add list/create/set-password/delete for `agency_admin`. Enforce role/client_id constraint before database write and return users without `password_hash`.

- [ ] **Step 4: Implement `/api/clients`**

Add list/create/get/patch/delete. `agency_admin` and `marketer` can manage; `client` can only get own client.

- [ ] **Step 5: Implement `/api/campaigns`**

Add list/create/get/patch/delete. Client users can only read own client campaigns. Soft delete campaigns.

- [ ] **Step 6: Implement `/api/links`**

Add list/create/get/patch/delete. Create validates `expires_at <= now + 365 days`, campaign belongs to client and agency, short code unique. On collision, regenerate until insert succeeds; do not expose collision error to users. Patch/delete invalidates Redis cache.

- [ ] **Step 7: Verify CRUD task**

Run: `pnpm --filter @trackflow/api test && pnpm --filter @trackflow/api typecheck`

Expected: CRUD, tenancy, and RBAC tests pass.

- [ ] **Step 8: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/api
git commit -m "feat: add tenant-scoped CRUD APIs"
```

---

### Task 6: Worker Shell, Queue Consumers, Analytics, and Click Processing

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/queue/rabbitmq.ts`
- Create: `apps/worker/src/queue/consumers.ts`
- Create: `apps/worker/src/clicks/handleClickRecorded.ts`
- Create: `apps/worker/src/analytics/userAgent.ts`
- Create: `apps/worker/src/analytics/referrer.ts`
- Create: `apps/worker/src/geo/provider.ts`

- [ ] **Step 1: Create worker package manifest**

Use dependencies: `@trackflow/db`, `@trackflow/shared`, `amqplib`, `ua-parser-js`, `zod`, `nodemailer`, `luxon`, `playwright` or `puppeteer`.

- [ ] **Step 2: Write unit tests for analytics first**

Create `apps/worker/src/analytics/userAgent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './userAgent.js';

describe('parseUserAgent', () => {
  it('parses iPhone as mobile with analytics fields', () => {
    const parsed = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    expect(parsed.device_type).toBe('mobile');
    expect(parsed.os).toBe('iOS');
    expect(parsed.browser).toBe('Mobile Safari');
  });

  it('does not throw for unknown UA', () => {
    expect(() => parseUserAgent('unknown')).not.toThrow();
  });
});
```

Create `apps/worker/src/analytics/referrer.test.ts` asserting `https://instagram.com/path?utm_source=ig&utm_medium=social` returns `referrer_domain: 'instagram.com'`, `utm_source: 'ig'`, `utm_medium: 'social'`.

Create `apps/worker/src/geo/provider.test.ts` asserting timeout/error returns null geo fields.

- [ ] **Step 3: Implement analytics parsers**

`parseUserAgent` returns all fields from `DATA_MODEL.md` with nulls for unknown values. `parseReferrer` returns `referrer`, `referrer_domain`, and UTM fields.

- [ ] **Step 4: Implement provider-agnostic GeoIP client**

`lookupGeoIp(ip)` calls `GEOIP_API_URL` with API key header `Authorization: Bearer ${GEOIP_API_KEY}` when key exists. Normalize response keys into `country`, `region`, `city`, `latitude`, `longitude`, `timezone`, `isp`, `asn`. Abort after `GEOIP_TIMEOUT_MS`. Return null fields on error.

- [ ] **Step 5: Implement RabbitMQ consumer shell**

Declare exchange/queues/DLQs exactly as `EVENTS.md`. Consume each queue with manual ack/nack. Retry can be implemented by message headers `x-attempts` and delayed requeue via `setTimeout` republish, or by RabbitMQ TTL retry queues. Keep behavior matching the documented backoff.

- [ ] **Step 6: Implement `click.recorded` handler**

In `handleClickRecorded`, check `clicks.event_id`; if exists, ACK. Otherwise parse UA, geo, referrer, compute hashes, write click and update `links.last_clicked_at` in one transaction. Do not persist raw IP or raw User-Agent.

- [ ] **Step 7: Verify worker click processing**

Run: `pnpm --filter @trackflow/worker test && pnpm --filter @trackflow/worker typecheck`

Expected: analytics and click idempotency unit tests pass.

- [ ] **Step 8: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/worker
git commit -m "feat: process click events with analytics"
```

---

### Task 7: Outbox Relay and Integration Tests for Click Durability

**Files:**
- Create: `apps/worker/src/queue/outboxRelay.ts`
- Create: `tests/integration/package.json`
- Create: `tests/integration/click-recorded.test.ts`
- Create: `tests/integration/redirect-outbox.test.ts`

- [ ] **Step 1: Implement outbox relay**

Poll `event_outbox` every second, up to 100 pending rows, publish with confirm, set `published`; on error increment attempts and set `failed` after 10 attempts.

- [ ] **Step 2: Write integration test for `click.recorded`**

Test publishes one click event and asserts a `clicks` row exists with analytics fields and no raw IP/UA columns.

- [ ] **Step 3: Write duplicate event integration test**

Publish the same `event_id` twice and assert exactly one `clicks` row.

- [ ] **Step 4: Write redirect outbox fallback integration test**

Simulate RabbitMQ publish failure by injecting a publisher that returns false; request `GET /1X2-d4F`; assert 302 and one pending `event_outbox` row.

- [ ] **Step 5: Verify durability tests**

Run: `pnpm test --filter integration`

Expected: click ingestion, duplicate idempotency, and outbox fallback tests pass.

- [ ] **Step 6: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/worker tests/integration
git commit -m "test: verify click durability and outbox relay"
```

---

### Task 8: Stats APIs and Dashboard Queries

**Files:**
- Create: `apps/api/src/modules/stats/routes.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write stats tests**

Create tests for `GET /api/links/:id/stats` asserting response includes `total_clicks`, `unique_clicks`, `clicks_over_time`, `by_country`, `by_city`, `by_device`, `by_browser`, `by_os`, and `by_referrer`.

- [ ] **Step 2: Implement link stats**

Use direct `clicks` queries filtered by `agency_id`, `link_id`, and date range. Unique clicks use distinct tuple semantics for `link_id`, `ip_hash`, `user_agent_hash`; if Prisma cannot express the exact distinct tuple efficiently, use parameterized raw SQL.

- [ ] **Step 3: Implement campaign stats and dashboard**

Reuse the same aggregation helpers filtered by `campaign_id` or dashboard filters. Client users must always be restricted to their own `client_id`.

- [ ] **Step 4: Verify stats**

Run: `pnpm --filter @trackflow/api test && pnpm --filter @trackflow/api typecheck`

Expected: stats tests pass and queries include tenancy filters.

- [ ] **Step 5: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/api/src/modules/stats apps/api/src/app.ts
git commit -m "feat: add direct click statistics APIs"
```

---

### Task 9: Report APIs, PDF Generation, Download, and Notifications

**Files:**
- Create: `apps/api/src/modules/reports/routes.ts`
- Create: `apps/worker/src/reports/handleReportRequested.ts`
- Create: `apps/worker/src/reports/pdf.ts`
- Create: `apps/worker/src/notifications/handleNotificationSend.ts`
- Create: `tests/integration/reports.test.ts`

- [ ] **Step 1: Write report API tests**

Test `POST /api/reports` returns 202 and creates pending report. Test client users can only read/download own client reports.

- [ ] **Step 2: Implement report API routes**

Create pending report, publish `report.requested`, list reports, get report, and stream `application/pdf` from `/api/reports/:id/download` only when status is done and file exists.

- [ ] **Step 3: Implement PDF generation**

Generate a simple PDF with client name, date range, total clicks, unique clicks, top links, top countries, top devices, top browsers, top OS, top referrers. Save to `/app/storage/reports/report_{id}.pdf`.

- [ ] **Step 4: Implement `report.requested` handler**

Set processing, read direct from `clicks`, generate PDF, set done and publish notification. On permanent data error set failed; on infrastructure error retry.

- [ ] **Step 5: Implement notification sender**

Use Nodemailer SMTP config. Render text/HTML for `report_ready`, `weekly_report`, `alert_no_clicks`, and `password_reset_request`.

- [ ] **Step 6: Verify reports**

Run: `pnpm --filter @trackflow/api test && pnpm --filter @trackflow/worker test && pnpm test --filter integration`

Expected: PDF file exists, report status becomes done, and Mailhog receives notification in integration test.

- [ ] **Step 7: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/api/src/modules/reports apps/worker/src/reports apps/worker/src/notifications tests/integration/reports.test.ts
git commit -m "feat: add async PDF reports"
```

---

### Task 10: Weekly Reports and No-Click Alerts

**Files:**
- Create: `apps/worker/src/cron/weeklyReport.ts`
- Create: `apps/worker/src/cron/noClickAlerts.ts`
- Create: `tests/integration/cron.test.ts`

- [ ] **Step 1: Write cron unit tests**

Test previous full week calculation in Europe/Warsaw. Test alert dedupe returns one notification per link per recipient per agency-local date.

- [ ] **Step 2: Implement weekly report cron**

Every 5 minutes, find agencies whose local time is Monday >= 08:00 and create one weekly report per client for previous full week if none exists for same agency/client/type/date range. Publish `report.requested` for each.

- [ ] **Step 3: Implement no-click alerts cron**

Every 15 minutes, find active links in active campaigns where no click for 24h or never clicked and older than 24h. Send to `link.created_by` plus all `role=marketer` users in agency. Exclude `agency_admin` unless represented by a separate marketer user. Insert `alert_deliveries` to dedupe.

- [ ] **Step 4: Verify cron behavior**

Run: `pnpm --filter @trackflow/worker test && pnpm test --filter integration`

Expected: weekly report creates reports and Mailhog e-mails for client users; alerts e-mail created_by and marketers only once per day.

- [ ] **Step 5: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/worker/src/cron tests/integration/cron.test.ts
git commit -m "feat: add report and alert cron jobs"
```

---

### Task 11: SvelteKit Frontend Contract Implementation

**Files:**
- Create all files listed under `apps/web/` in File Structure

- [ ] **Step 1: Create SvelteKit app package**

Create `apps/web/package.json` with SvelteKit, Vite, TypeScript. Configure `PUBLIC_API_BASE_URL`.

- [ ] **Step 2: Implement API client and session store**

Create `src/lib/api.ts` wrapping fetch with Bearer token and JSON error handling. Create `src/lib/session.ts` storing JWT/user in localStorage.

- [ ] **Step 3: Implement auth pages**

Login page calls `POST /auth/login`. Password reset request page calls `POST /auth/password-reset-request` and always shows accepted message.

- [ ] **Step 4: Implement dashboard and CRUD pages**

Dashboard calls `/api/dashboard`. Clients, campaigns, links, reports, and users pages call their corresponding APIs. Hide users page unless role is `agency_admin`. Client users get read-only campaign/link/stats/report views.

- [ ] **Step 5: Implement stats and reports pages**

Link details page shows time series, country/city table, device/browser/OS/referrer/UTM tables. Reports page creates manual reports, polls every 3 seconds until done/failed, and downloads via `/api/reports/:id/download`.

- [ ] **Step 6: Verify frontend**

Run: `pnpm --filter @trackflow/web typecheck && pnpm --filter @trackflow/web build`

Expected: SvelteKit build succeeds.

- [ ] **Step 7: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/web
git commit -m "feat: add SvelteKit web app"
```

---

### Task 12: Dockerfiles and End-to-End Verification

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/web/Dockerfile`
- Modify: `infra/docker-compose.yml` only if paths/env vars differ from current convention

- [ ] **Step 1: Create API Dockerfile**

Use Node 22 Alpine, install pnpm, copy workspace, install production deps, build API, run `node apps/api/dist/main.js`.

- [ ] **Step 2: Create worker Dockerfile**

Use Node 22 Alpine plus browser dependencies if Playwright/Puppeteer requires them. Build worker and run `node apps/worker/dist/main.js`.

- [ ] **Step 3: Create web Dockerfile**

Build SvelteKit and serve on port 4173 using the SvelteKit Node adapter output.

- [ ] **Step 4: Validate Compose config**

Run: `docker compose -f infra/docker-compose.yml config`

Expected: exits 0 and shows api, worker, web, postgres, redis, rabbitmq, mailhog.

- [ ] **Step 5: Run full stack**

Run: `docker compose -f infra/docker-compose.yml up --build`

Expected: all services become healthy or stay running without crash loops.

- [ ] **Step 6: Run final functional checks**

Run:

```bash
curl -o /dev/null -s -w "Total: %{time_total}s\n" http://localhost:3000/1X2-d4F
curl -s http://localhost:3000/health
```

Expected: redirect total < `0.080s` under normal local conditions and health returns `{"ok":true}`.

- [ ] **Step 7: Run final automated verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit if repository exists**

Run: `git status`. If this is a git repository, commit:

```bash
git add apps/*/Dockerfile infra/docker-compose.yml
git commit -m "chore: add Docker deployment"
```

---

## Self-Review

Spec coverage:

- Agency tenancy, roles, clients, campaigns, links: Tasks 2, 3, 5.
- Redirect <80ms with Redis, RabbitMQ confirm, outbox fallback: Task 4, Task 12.
- Click durability, idempotency, full device analytics, external GeoIP: Tasks 6 and 7.
- Stats direct from clicks: Task 8.
- Reports, PDF, download, notifications: Task 9.
- Weekly reports and no-click alerts: Task 10.
- SvelteKit frontend contract: Task 11.
- Docker Compose deployment: Task 12.

Type consistency:

- Event payload names match `docs/contracts/EVENTS.md`.
- Click analytics field names match `docs/architecture/DATA_MODEL.md`.
- API route paths match `docs/contracts/API.md`.

Verification requirements:

- Each task includes command-level verification.
- Final task includes Docker Compose validation, stack startup, redirect timing, lint, typecheck, tests, and build.
