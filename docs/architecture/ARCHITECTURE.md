# Architektura systemu — TrackFlow

## 1. Back-of-envelope math

Dane z briefu: 200 000 kliknięć/miesiąc dziś -> 2 000 000 za rok.

```text
Kliknięć / dzień (dziś):           ~6 667
Kliknięć / sekundę (dziś):         ~0.08 średnio
Kliknięć / sekundę (za rok):       ~0.77 średnio
Peak safety factor:                10x-30x średniej, projektujemy pod ~25 req/s redirectu
Rekordów w tabeli clicks po roku:  ~13 200 000 (liniowy wzrost 0.2M -> 2M/mies.)
Szacowana wielkość tabeli clicks:  ~5-10 GB z indeksami
Raporty PDF / tydzień:             dziś ~40, za rok ~200
```

Wnioski:

```text
Bottleneck #1 to redirect ponieważ jest synchroniczny i ma limit < 80ms.
Bottleneck #2 to worker kliknięć ponieważ każde kliknięcie wymaga UA parsing, geo i zapisu.
Redirect NIE może iść do bazy przy każdym requestcie ponieważ cache hit musi być stabilnie szybki, a baza jest współdzielona ze statystykami i raportami.
Cache jest potrzebny dla short_code -> metadane redirectu i trzymam w nim link_id, agency_id, client_id, campaign_id, original_url, expires_at, status, created_by.
Zapis kliknięcia jest asynchroniczny ponieważ geo/UA i zapis statystyk nie mogą blokować 302.
```

## 2. C1 — Context Diagram

```text
[Marketer] --tworzy kampanie/linki, ogląda statystyki, generuje raporty--> [TRACKFLOW]
[Agency Admin] --zarządza użytkownikami, klientami i zakresem agencji--> [TRACKFLOW]
[Klient agencji] --czyta własne statystyki i raporty--> [TRACKFLOW]
[Osoba klikająca] --GET /:short_code--> [TRACKFLOW] --302--> [Docelowy URL]
[TRACKFLOW] --HTTPS lookup IP--> [External GeoIP API]
[TRACKFLOW] --SMTP--> [Serwer SMTP / Mailhog]
```

| Element | Typ | Co robi |
|---------|-----|---------|
| Agency Admin | Aktor | Zarządza użytkownikami, klientami, kampaniami, linkami i raportami w swojej agencji. |
| Marketer | Aktor | Tworzy kampanie i linki, przegląda statystyki, generuje raporty. |
| Klient agencji | Aktor | Ma dostęp tylko do odczytu statystyk i raportów swojego klienta. |
| Osoba klikająca | Aktor | Klika krótki link, dostaje redirect. |
| External GeoIP API | System zewnętrzny | Geolokalizacja IP przez konfigurowalnego providera. |
| SMTP / Mailhog | System zewnętrzny | Wysyłanie e-maili w prod przez SMTP, lokalnie przez Mailhog. |
| Docelowy URL | System zewnętrzny | Oryginalna strona kampanii. |

## 3. C2 — Container Diagram

| Kontener | Technologia | Odpowiedzialność |
|----------|-------------|-----------------|
| api | Node.js, TypeScript, Fastify, Prisma | REST API, auth, redirect, publish eventów, outbox fallback. |
| worker | Node.js, TypeScript, Prisma, RabbitMQ consumer, Nodemailer | Konsumenci eventów, cron weekly-report, cron alert-no-clicks, PDF, e-mail, external geo, device analytics. |
| web | SvelteKit | Web UI: login, dashboard, kampanie/linki, statystyki, raporty. |
| postgres | PostgreSQL 16 | Trwałe dane: tenancy, użytkownicy, linki, kliknięcia, raporty, outbox. |
| redis | Redis 7 | Cache redirectu i cache negatywny. Nie jest źródłem prawdy. |
| rabbitmq | RabbitMQ 3 Management | Durable queues, at-least-once delivery, DLQ, publish confirms. |
| mailhog | Mailhog | Dev SMTP i UI do testów maili. |

```text
Browser -> web: HTTP
web -> api: HTTP JSON /api/*
Clicker -> api: HTTP GET /:short_code
api -> redis: RESP cache lookup/write
api -> postgres: SQL przez Prisma, tylko miss/outbox/API
api -> rabbitmq: AMQP publish confirm
worker -> rabbitmq: AMQP consume/ack/nack
worker -> postgres: SQL przez Prisma
worker -> SMTP/Mailhog: SMTP
worker -> External GeoIP API: HTTPS
```

Worker jest osobnym kontenerem, bo przetwarzanie kliknięć, PDF, cron i e-mail są wolniejsze oraz retry-owalne; nie mogą obciążać procesu redirect/API.

Kliknięcie nie idzie od razu do bazy w endpointcie redirect, bo geo/UA i zapis statystyk przekroczyłyby budżet 80ms i zwiększyły wariancję czasu odpowiedzi.

W cache trzymamy metadane linku potrzebne do walidacji redirectu i publikacji eventu bez odczytu z PostgreSQL na cache hit.

## 4. Przepływ — Redirect (< 80ms)

| Krok | Opis | Czas (ms) |
|------|------|-----------|
| 1 | Odczyt `redirect:{short_code}` z Redis | ~1-3 |
| 2 | Cache hit: walidacja status/expires_at w pamięci procesu | ~1 |
| 3 | Przygotowanie eventu i publish do RabbitMQ z confirm w dynamicznym budżecie | ~5-20 |
| 4 | Jeśli RabbitMQ niedostępny: minimalny insert do `event_outbox` w pozostałym budżecie | ~5-30 |
| 5 | Wysłanie `302 Location` | ~1 |
| **Suma** | Typowo cache hit + RabbitMQ confirm | **~10-30** |
| **Suma worst-case** | Cache hit + outbox fallback | **~30-60** |

```text
Co przy cache miss: sprawdź PostgreSQL po short_code, status, deleted_at i expires_at; jeśli aktywny, zapisz cache i kontynuuj redirect; jeśli nieaktywny, zapisz cache negatywny 60s i zwróć 404 text/plain.
Co gdy Redis jest down: jednorazowo sprawdź PostgreSQL i kontynuuj redirect; loguj degraded mode. Brak Redis nie blokuje redirectu.
```

Budżet RabbitMQ/outbox jest dynamiczny: API mierzy średnie czasy publish confirm i outbox insert, a następnie przesuwa budżet w ramach limitu redirectu. Twardy limit odpowiedzi pozostaje <80ms.

## 5. Przepływ — Przetwarzanie kliknięcia (max 5s)

| Krok | Opis | Kto |
|------|------|-----|
| 1 | API publikuje `click.recorded` do RabbitMQ albo zapisuje `event_outbox` fallback. | API |
| 2 | Worker konsumuje event z `trackflow.clicks`. | Worker |
| 3 | Worker sprawdza `event_id` w `clicks`; duplikat ACK bez zapisu. | Worker |
| 4 | Worker parsuje pełne device analytics z UA, geolokalizuje IP przez external GeoIP API, hashuje IP i UA. | Worker |
| 5 | Worker zapisuje `clicks`, aktualizuje `links.last_clicked_at`, ACK po commicie. | Worker |

```text
Co gwarantuje że dane nie zginą: RabbitMQ durable queues + persistent messages + publish confirm; przy awarii RabbitMQ minimalny PG outbox; ACK dopiero po zapisie w PostgreSQL.
Jak zapewniasz idempotentność: `clicks.event_id` UNIQUE i check przed zapisem.
```

## 6. Przepływ — Generowanie raportu PDF

| Krok | Opis |
|------|------|
| 1 | Marketer tworzy raport przez `POST /api/reports` z `client_id`, opcjonalnie `link_ids`, `date_from`, `date_to`. |
| 2 | API tworzy `reports(status=pending)` i publikuje `report.requested`, zwraca 202. |
| 3 | Worker ustawia `processing`, czyta dane bezpośrednio z `clicks`, generuje PDF. |
| 4 | Worker zapisuje PDF w `/app/storage/reports/report_{id}.pdf`, ustawia `done`, publikuje `notification.send` dla raportu ręcznego. |
| 5 | Frontend polluje `GET /api/reports/:id` co 3s i pobiera przez `GET /api/reports/:id/download`. |

```text
Dlaczego async: PDF i zapytania statystyczne są wolniejsze niż request HTTP i muszą mieć retry.
Gdzie jest przechowywany PDF: lokalny persistent volume `/app/storage/reports`.
Jak marketer dostaje info: polling statusu w UI oraz opcjonalny e-mail po wygenerowaniu.
```

## 7. Failure scenarios

| Komponent pada | Co robi system | Dane bezpieczne? |
|---------------|----------------|-----------------|
| Redis | API czyta PostgreSQL przy redirect cache miss/degraded mode, nie zapisuje cache; loguje awarię. | Tak, Redis nie jest źródłem prawdy. |
| RabbitMQ | API zapisuje minimalny event do `event_outbox`; worker/outbox relay publikuje później. | Tak, jeśli PostgreSQL działa. |
| Worker | RabbitMQ trzyma nie-ACK eventy; po restarcie worker kontynuuje. | Tak. |
| PostgreSQL | API nie może tworzyć linków ani zapisać outbox; cache hit może nadal redirectować przez krótki czas, ale event durability jest krytycznie zdegradowane. | Nie w pełni; wymaga alertu operatora i trwałego wolumenu/backupów. |
| External GeoIP API | Worker stosuje timeout i fallback; jeśli API nie odpowiada, zapisujemy null dla pól geo i nie failujemy eventu. | Tak, kliknięcie zapisane bez geo. |
| SMTP | `notification.send` retry; po limitach DLQ. Raport PDF nadal zapisany. | Tak, dane raportu są bezpieczne. |

## 8. Indeksy bazy danych

| Tabela | Kolumna(y) | Uzasadnienie |
|--------|-----------|--------------|
| agencies | slug | Globalnie unikalny identyfikator agencji. |
| users | agency_id, email | Login i unikalność e-maila w agencji. |
| users | agency_id, role | Listy użytkowników i odbiorcy powiadomień. |
| clients | agency_id, name | Lista klientów w agencji. |
| campaigns | agency_id, client_id, status | Dashboard i raporty po kliencie/kampanii. |
| links | short_code | Krytyczny lookup redirectu, globalnie unique. |
| links | agency_id, client_id, campaign_id | Listy i filtry linków. |
| links | status, expires_at, deleted_at | Wybór aktywnych linków i alerty. |
| links | last_clicked_at | Alert no-clicks. |
| clicks | event_id | Idempotency consumera. |
| clicks | link_id, clicked_at | Statystyki i raporty dla linku w zakresie dat. |
| clicks | client_id, clicked_at | Raport tygodniowy klienta. |
| clicks | campaign_id, clicked_at | Raporty i dashboard kampanii. |
| clicks | link_id, ip_hash, user_agent_hash, clicked_at | Unique clicks w zakresie dat. |
| clicks | country, clicked_at | Mapa i top kraje. |
| clicks | device_type, clicked_at | Top urządzenia. |
| clicks | browser, clicked_at | Analityka przeglądarek. |
| clicks | os, clicked_at | Analityka systemów operacyjnych. |
| clicks | referrer_domain, clicked_at | Top referrery. |
| reports | agency_id, client_id, created_at | Lista raportów i autoryzacja. |
| reports | status, created_at | Worker i polling. |
| alert_deliveries | link_id, alert_type, sent_for_date | Deduplikacja alertów raz dziennie per link. |
| event_outbox | status, created_at | Relay eventów po awarii RabbitMQ. |
