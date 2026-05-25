# CLAUDE.md — Instrukcje dla agenta

## Kim jesteś i co budujesz

Jesteś seniorem TypeScript/Fastify/SvelteKit implementującym TrackFlow — system skracania i śledzenia linków dla agencji marketingowej.

## Dokumenty które czytasz PRZED pisaniem kodu

1. docs/BRIEF.md
2. docs/architecture/ARCHITECTURE.md
3. docs/architecture/DECISIONS.md
4. docs/architecture/DATA_MODEL.md
5. docs/contracts/API.md
6. docs/contracts/EVENTS.md
7. docs/contracts/WORKER.md

Jeśli cokolwiek jest niejasne — ZATRZYMAJ SIĘ i zapytaj. Nie zgaduj.

## Stack technologiczny

Backend:
  Język:        TypeScript / Node.js
  Framework:    Fastify
  ORM:          Prisma

Frontend:
  Framework:    SvelteKit
  Stylowanie:   CSS lub lekki system komponentów wybrany podczas implementacji, bez zmiany kontraktów API

Infrastruktura:
  Cache:        Redis
  Kolejka:      RabbitMQ
  Baza danych:  PostgreSQL
  E-mail (dev): Mailhog
  E-mail (prod): Generic SMTP przez Nodemailer
  PDF storage:  Lokalny persistent volume `/app/storage/reports`
  GeoIP:        External GeoIP API przez konfigurowalnego providera

Testy:
  Jednostkowe:  Vitest
  Integracyjne: Vitest + Testcontainers lub Docker Compose test services

## Zasady których ZAWSZE przestrzegasz

**Kontrakty są nienaruszalne**
- API implementujesz DOKŁADNIE zgodnie z `docs/contracts/API.md`.
- Payload eventów DOKŁADNIE zgodny z `docs/contracts/EVENTS.md`.
- Worker implementujesz DOKŁADNIE zgodnie z `docs/contracts/WORKER.md`.

**Tenancy jest obowiązkowe**
- `agencies` są first-class entity.
- Każde zapytanie biznesowe poza publicznym redirectem filtruje dane po `agency_id`.
- Client user ma dokładnie jeden `client_id` i widzi tylko dane tego klienta.
- Nie implementuj billing, planów, custom domen, self-signup ani onboardingu agencji w v1.

**Redirect jest krytyczny**
- `GET /:short_code` musi odpowiedzieć w < 80ms.
- Kolejność: sprawdź Redis -> miss: sprawdź PG -> zapisz Redis -> opublikuj `click.recorded` z RabbitMQ publish confirm w dynamicznym budżecie -> fallback PG outbox gdy RabbitMQ nie działa -> 302.
- Na cache hit nie czytaj PostgreSQL.
- Expired/deleted/inactive link albo paused/archived campaign zwraca `404 text/plain` z `Link not found`.
- Używaj HTTP 302, nie 301.

**Dane kliknięć nie mogą zginąć**
- RabbitMQ messages persistent, queues durable, publish confirm w API.
- Jeśli publish do RabbitMQ nie działa, zapisz envelope do `event_outbox`.
- Consumer sprawdza `event_id` przed przetworzeniem.
- ACK dopiero po zapisie do bazy.
- Raw IP i raw User-Agent mogą być w evencie, ale w PostgreSQL zapisuj tylko `ip_hash`, `user_agent_hash` i znormalizowane pola geo/device/referrer analytics.

**Raporty i alerty**
- Raporty weekly: poprzedni pełny tydzień kalendarzowy w timezone agencji, poniedziałek 08:00 z tolerancją 15 minut.
- Raporty czytają bezpośrednio z tabeli `clicks`; brak agregatów w v1.
- PDF zapisuj w `/app/storage/reports/report_{id}.pdf`.
- Alert no-clicks: aktywny link aktywnej kampanii bez kliknięcia przez 24h; raz dziennie per link per odbiorca; odbiorcy to `link.created_by` i wszyscy `role=marketer` w agencji, bez agency_admin jeśli nie jest marketerem.

**Testy są obowiązkowe**
- Po każdym module uruchom testy i raportuj wynik.
- Testy z `WORKER.md` sekcja "Testy które agent musi napisać" są obowiązkowe.

## Kolejność implementacji

Po każdym kroku uruchom testy i zaraportuj.

```text
Krok 1:  Inicjalizacja monorepo, Docker Compose, Dockerfile(i), zmienne środowiskowe
Krok 2:  Schemat bazy danych + migracje Prisma
Krok 3:  Seed danych
Krok 4:  Auth — login, password reset request, JWT middleware
Krok 5:  Tenancy middleware i RBAC
Krok 6:  Endpoint redirect GET /:short_code z Redis, RabbitMQ confirm i outbox fallback
Krok 7:  Publisher eventu click.recorded + outbox relay
Krok 8:  CRUD agencies/current, users, clients, campaigns
Krok 9:  CRUD linków
Krok 10: Consumer click.recorded (UA parser + geo + zapis)
Krok 11: Endpointy statystyk
Krok 12: Consumer report.requested + PDF + download
Krok 13: Consumer notification.send + e-mail
Krok 14: Cron weekly-report
Krok 15: Cron alert-no-clicks
Krok 16: Frontend SvelteKit — auth, dashboard, klienci, kampanie, linki
Krok 17: Frontend SvelteKit — statystyki, raporty, polling, download
Krok 18: Testy integracyjne end-to-end
Krok 19: Weryfikacja docker-compose up i redirect <80ms
```

## Format raportowania

```text
Krok N ukończony
  Zbudowałem: [1 zdanie]
  Testy: [X passed, Y failed]
  Do sprawdzenia przez zespół: [tak/nie + co]
```

## Weryfikacja redirectu

```bash
curl -o /dev/null -s -w "Total: %{time_total}s\n" http://localhost:3000/1X2-d4F
# Oczekiwane: < 0.080s
```

## Dane testowe

Seed musi dodać:

- 1 agencję: `TrackFlow Beta Agency`, timezone `Europe/Warsaw`
- 1 agency admin: `admin@test.com`, hasło `test123`
- 1 marketer: `marketer@test.com`, hasło `test123`
- 1 client user: `client@test.com`, hasło `test123`
- 3 klientów agencji
- 5 kampanii
- 5 linków z kodami w formacie `XXX-XXX`, w tym `1X2-d4F`
- 100 kliknięć z ostatnich 7 dni

## Dodatkowe instrukcje

1. Short code: dokładnie 3 znaki Base62, myślnik, 3 znaki Base62 (`XXX-XXX`), globalnie unikalny.
2. Link może być aktywny maksymalnie 365 dni; `expires_at` jest wymagane.
3. Nie dodawaj rate limitów w v1.
4. Nie dodawaj audit logs w v1.
5. Nie wywołuj external GeoIP API w endpointcie redirect; tylko worker.
