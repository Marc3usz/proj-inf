# Kontrakt REST API — TrackFlow

## Konwencje

```text
Autentykacja:  Bearer JWT w headerze Authorization
Format:        JSON, poza publicznym 404 redirectu który zwraca text/plain
Błędy:         { "code": "ERROR_CODE", "message": "opis" }
Paginacja:     ?page=1&limit=20 -> { "data": [], "total": N, "page": N, "limit": N }
Daty:          ISO 8601 UTC w API; raporty tygodniowe liczone w timezone agencji
```

Role:

- `agency_admin`: zarządza użytkownikami, klientami, kampaniami, linkami i raportami w swojej agencji.
- `marketer`: zarządza klientami, kampaniami, linkami i raportami w swojej agencji; nie zarządza użytkownikami.
- `client`: odczyt statystyk i raportów tylko dla swojego `client_id`.

## AUTH

### POST /auth/login

**Auth:** Brak

**Request:**
```json
{ "email": "string", "password": "string" }
```

**Response 200:**
```json
{
  "token": "JWT",
  "user": {
    "id": "uuid",
    "agency_id": "uuid",
    "client_id": "uuid | null",
    "email": "string",
    "role": "agency_admin | marketer | client"
  }
}
```

**Response 401:** `{ "code": "INVALID_CREDENTIALS", "message": "Invalid email or password" }`

### POST /auth/password-reset-request

**Auth:** Brak

**Request:**
```json
{ "email": "string" }
```

**Response 202:**
```json
{ "status": "accepted" }
```

Zawsze zwraca 202. Jeśli użytkownik istnieje, worker wysyła e-mail do `agency_admin` w tej samej agencji z prośbą o reset.

## AGENCIES

### GET /api/agencies/current

**Auth:** agency_admin, marketer, client

**Response 200:**
```json
{ "id": "uuid", "name": "string", "slug": "string", "timezone": "Europe/Warsaw" }
```

### PATCH /api/agencies/current

**Auth:** agency_admin

**Request:**
```json
{ "name": "string", "timezone": "Europe/Warsaw" }
```

**Response 200:** agency object.

## USERS

### GET /api/users

**Auth:** agency_admin

**Query params:** `page`, `limit`, `role`, `client_id`, `search`

**Response 200:** paginated users without `password_hash`.

### POST /api/users

**Auth:** agency_admin

**Request:**
```json
{
  "email": "user@example.com",
  "password": "string",
  "role": "agency_admin | marketer | client",
  "client_id": "uuid | null",
  "name": "string | null"
}
```

**Response 201:** user object without `password_hash`.

### POST /api/users/:id/set-password

**Auth:** agency_admin

**Request:**
```json
{ "password": "string" }
```

**Response 204:** no body.

### DELETE /api/users/:id

**Auth:** agency_admin

**Response 204:** soft delete.

## CLIENTS

### GET /api/clients

**Auth:** agency_admin, marketer

**Query params:** `page`, `limit`, `search`

**Response 200:** paginated clients.

### POST /api/clients

**Auth:** agency_admin, marketer

**Request:**
```json
{ "name": "string" }
```

**Response 201:** client object.

### GET /api/clients/:id

**Auth:** agency_admin, marketer, client self only

**Response 200:** client object.

### PATCH /api/clients/:id

**Auth:** agency_admin, marketer

**Request:**
```json
{ "name": "string" }
```

**Response 200:** client object.

### DELETE /api/clients/:id

**Auth:** agency_admin

**Response 204:** soft delete if no active campaigns/links.

## CAMPAIGNS

### GET /api/campaigns

**Auth:** agency_admin, marketer, client

**Query params:** `page`, `limit`, `client_id`, `status`, `search`

Client users may only see campaigns for their `client_id`.

### POST /api/campaigns

**Auth:** agency_admin, marketer

**Request:**
```json
{ "client_id": "uuid", "name": "string", "status": "active | paused | archived" }
```

**Response 201:** campaign object.

### GET /api/campaigns/:id

**Auth:** agency_admin, marketer, client self only

**Response 200:** campaign object.

### PATCH /api/campaigns/:id

**Auth:** agency_admin, marketer

**Request:**
```json
{ "name": "string", "status": "active | paused | archived" }
```

**Response 200:** campaign object.

### DELETE /api/campaigns/:id

**Auth:** agency_admin, marketer

**Response 204:** soft delete.

## REDIRECT

### GET /:short_code

**Auth:** Brak publiczny

**Format short_code:** `^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$`

**Response 302:** Header `Location: <original_url>`

**Response 404:** `text/plain; charset=utf-8` body: `Link not found`

Expired, deleted, inactive link, paused/archived campaign: 404.

Publikuje `click.recorded` przez RabbitMQ publish confirm w dynamicznym budżecie przed zakończeniem odpowiedzi. Jeśli RabbitMQ nie działa, zapisuje minimalny event do `event_outbox` w PostgreSQL i zwraca 302.

## LINKS

### GET /api/links

**Auth:** agency_admin, marketer, client

**Query params:** `page`, `limit`, `client_id`, `campaign_id`, `status`, `search`

Client users widzą tylko linki swojego `client_id`.

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "agency_id": "uuid",
      "client_id": "uuid",
      "campaign_id": "uuid",
      "short_code": "1X2-d4F",
      "short_url": "https://trckflw.io/1X2-d4F",
      "original_url": "https://example.com",
      "status": "active",
      "expires_at": "ISO8601",
      "last_clicked_at": "ISO8601 | null",
      "created_by": "uuid",
      "created_at": "ISO8601"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### POST /api/links

**Auth:** agency_admin, marketer

**Request:**
```json
{
  "client_id": "uuid",
  "campaign_id": "uuid",
  "original_url": "https://example.com",
  "expires_at": "ISO8601",
  "status": "active | inactive"
}
```

`expires_at` jest wymagane i musi być <= `created_at + 365 days`.

**Response 201:** pełny obiekt linku jak w `GET /api/links`.

**Response 400:** `{ "code": "VALIDATION_ERROR", "message": "..." }`

### GET /api/links/:id

**Auth:** agency_admin, marketer, client self only

**Response 200:** pełny obiekt linku.

**Response 404:** `{ "code": "NOT_FOUND", "message": "Link not found" }`

### PATCH /api/links/:id

**Auth:** agency_admin, marketer

**Request:**
```json
{ "original_url": "https://example.com", "expires_at": "ISO8601", "status": "active | inactive" }
```

**Response 200:** pełny obiekt linku. Po zmianie invaliduje Redis `redirect:{short_code}`.

### DELETE /api/links/:id

**Auth:** agency_admin, marketer

**Response 204:** soft delete i invalidacja cache.

## STATYSTYKI

### GET /api/links/:id/stats

**Auth:** agency_admin, marketer, client self only

**Query params:**
```text
period:    "hour" | "day" | "week"
date_from: ISO 8601 (opcjonalny)
date_to:   ISO 8601 (opcjonalny)
```

**Response 200:**
```json
{
  "total_clicks": 1234,
  "unique_clicks": 890,
  "clicks_over_time": [{ "timestamp": "ISO8601", "count": 45 }],
  "by_country": [{ "country": "PL", "count": 500 }],
  "by_city": [{ "city": "Warsaw", "country": "PL", "count": 120 }],
  "by_device": [{ "device_type": "mobile", "count": 700 }],
  "by_browser": [{ "browser": "Chrome", "browser_version": "125", "count": 300 }],
  "by_os": [{ "os": "iOS", "os_version": "17", "count": 220 }],
  "by_referrer": [{ "referrer": "instagram.com", "count": 300 }]
}
```

`unique_clicks` = distinct `(link_id, ip_hash, user_agent_hash)` w zakresie dat.

### GET /api/campaigns/:id/stats

**Auth:** agency_admin, marketer, client self only

Te same query params i response jak link stats, agregowane po `campaign_id`.

### GET /api/dashboard

**Auth:** agency_admin, marketer, client

**Query params:** `client_id`, `date_from`, `date_to`

**Response 200:**
```json
{
  "total_links": 100,
  "active_links": 80,
  "total_clicks": 12345,
  "unique_clicks": 9000,
  "top_links": [{ "link_id": "uuid", "short_code": "1X2-d4F", "clicks": 500 }],
  "clicks_over_time": [{ "timestamp": "ISO8601", "count": 45 }],
  "by_country": [{ "country": "PL", "count": 500 }],
  "by_device": [{ "device_type": "mobile", "count": 700 }],
  "by_browser": [{ "browser": "Chrome", "browser_version": "125", "count": 300 }],
  "by_os": [{ "os": "iOS", "os_version": "17", "count": 220 }],
  "by_referrer": [{ "referrer": "instagram.com", "count": 300 }]
}
```

## RAPORTY

### POST /api/reports

Async; zwraca 202 natychmiast.

**Auth:** agency_admin, marketer

**Request:**
```json
{
  "client_id": "uuid",
  "link_ids": ["uuid"],
  "date_from": "ISO8601",
  "date_to": "ISO8601"
}
```

`link_ids` opcjonalne. Jeśli puste/brak, raport obejmuje wszystkie linki klienta w zakresie.

**Response 202:**
```json
{ "report_id": "uuid", "status": "pending" }
```

### GET /api/reports

**Auth:** agency_admin, marketer, client

**Query params:** `page`, `limit`, `client_id`, `status`, `type`

Client users widzą tylko raporty swojego `client_id`.

**Response 200:** paginated report summaries.

### GET /api/reports/:id

**Auth:** agency_admin, marketer, client self only

**Response 200:**
```json
{
  "id": "uuid",
  "agency_id": "uuid",
  "client_id": "uuid",
  "type": "manual | weekly",
  "status": "pending | processing | done | failed",
  "download_url": "/api/reports/{id}/download | null",
  "error_message": "string | null",
  "date_from": "ISO8601",
  "date_to": "ISO8601",
  "created_at": "ISO8601",
  "completed_at": "ISO8601 | null"
}
```

Frontend polluje co 3 sekundy gdy status != done/failed.

### GET /api/reports/:id/download

**Auth:** agency_admin, marketer, client self only

**Response 200:** `application/pdf`

**Response 404:** report missing/not done/file missing.

## FRONTEND CONTRACT

SvelteKit UI musi mieć ekrany:

- Login: używa `POST /auth/login`.
- Password reset request: używa `POST /auth/password-reset-request`.
- Dashboard: używa `GET /api/dashboard`, filtry dat i klienta.
- Clients: lista/create/edit dla agency_admin/marketer.
- Campaigns: lista/create/edit/status dla agency_admin/marketer; read-only dla client.
- Links: lista/create/edit/delete, pokazuje `short_url`, status, expiry.
- Link stats: wykres czasu, mapa/tabela krajów i miast, top urządzenia, przeglądarki, systemy, referrery i UTM.
- Reports: lista, create manual, polling statusu, download PDF.
- Users: tylko agency_admin, lista/create/set-password/delete.
