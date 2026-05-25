# TrackFlow v1 Design

## Scope

TrackFlow v1 is a Docker Compose deployable link shortening and click tracking system for marketing agencies. It supports agency tenancy, agency users, clients, campaigns, links, fast redirects, click ingestion, stats, PDF reports, weekly report e-mails, password reset requests to agency admins, and no-click alerts.

Out of scope for v1: billing, plans, custom domains, public agency self-signup, agency onboarding flows, mobile app, A/B testing, rate limiting, audit logs, and hard-coding one GeoIP vendor.

## Recommended Architecture

The system uses TypeScript throughout. Fastify API handles auth, tenancy, CRUD, stats, redirect, RabbitMQ publishing, and outbox fallback. A separate worker consumes RabbitMQ messages, processes clicks, calls an external GeoIP API, parses full device analytics, generates PDFs, sends e-mails, runs crons, and relays outbox events. SvelteKit serves the web UI. PostgreSQL is the source of truth, Redis is redirect cache, RabbitMQ is durable event delivery, Mailhog is dev SMTP, and generic SMTP is used in production.

## Key Decisions

- Redirect path is public `GET /:short_code`; app APIs are under `/api/*`.
- Short code format is exactly `XXX-XXX` with Base62 characters, globally unique.
- Redirect uses HTTP 302 and returns `404 text/plain` with `Link not found` for expired, deleted, inactive, or paused/archived campaign links.
- API publishes `click.recorded` with RabbitMQ publish confirm before ending the 302 response when possible. If RabbitMQ fails, API stores the event envelope in PostgreSQL `event_outbox` and still redirects.
- Click worker is idempotent by `event_id` and ACKs only after PostgreSQL write.
- Raw IP and raw User-Agent appear only in the queue event; PostgreSQL stores `ip_hash`, `user_agent_hash`, normalized geo fields, normalized device analytics, and referrer/UTM fields.
- GeoIP is provider-agnostic external API integration configured by `GEOIP_PROVIDER`, `GEOIP_API_URL`, `GEOIP_API_KEY`, and `GEOIP_TIMEOUT_MS`; it is never called from redirect.
- Reports and stats read directly from `clicks` with indexes; no aggregate tables in v1.
- Weekly reports cover the previous full calendar week in agency timezone and must enqueue within 15 minutes of Monday 08:00 local time.

## Data Model

First-class tenancy is represented by `agencies`. Users belong to one agency and have roles `agency_admin`, `marketer`, or `client`. Client users have exactly one `client_id`. Clients, campaigns, links, clicks, reports, alerts, and outbox records all carry tenancy information either directly or via relations. Business queries outside redirect must filter by `agency_id`; client users additionally filter by `client_id`.

## Event Model

RabbitMQ uses durable topic exchange `trackflow.events` and durable queues for clicks, reports, and notifications. Events use a versioned envelope with `event_id`, `event_type`, `version`, `timestamp`, and `payload`. DLQs retain failed messages after retry limits. Outbox relay publishes pending PostgreSQL events every second.

## Frontend Contract

SvelteKit must display login, password reset request, dashboard, clients, campaigns, links, stats, reports, and users pages. It does not define concrete UI implementation details beyond required data and API interactions.

## Error Handling

Redis outage degrades redirect to PostgreSQL lookup. RabbitMQ outage uses PostgreSQL outbox. Worker outage is safe because RabbitMQ retains unacked messages. GeoIP or UA parsing errors write null fields and do not fail clicks. SMTP failures retry and then DLQ. PostgreSQL outage is the critical failure mode and requires operator intervention, persistent volumes, and backups.

## Testing Requirements

Implementation must include unit tests for full UA/device parsing, external GeoIP fallback, referrer/UTM parsing, idempotency, short-code format, weekly report period, and no-click dedupe. Integration tests must cover click ingestion with analytics fields, duplicate event handling, RabbitMQ down outbox fallback, outbox relay, PDF generation, weekly report e-mail, and alert recipient rules.

## Approval State

This design reflects the user-approved decisions from planning: SvelteKit, RabbitMQ, PostgreSQL, Redis, external provider-agnostic GeoIP API, full device analytics, local PDF storage, generic SMTP, first-class agencies, no rate limits, no audit logs, and required redirect durability with outbox fallback.
