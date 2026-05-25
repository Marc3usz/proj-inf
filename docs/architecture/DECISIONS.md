# Architecture Decision Records

## ADR-001 — Backend w TypeScript, Fastify i Prisma

**Status:** Zaakceptowana

**Kontekst:** Redirect musi odpowiadać w <80ms, API i worker mają współdzielić kontrakty i działać w Docker Compose utrzymywanym przez jednego developera.

**Problem:** Jak zbudować API i Worker żeby spełnić redirect <80ms przy wzroście 10x?

**Opcje:**
- A: TypeScript + Fastify + Prisma — szybki runtime, niskie narzuty frameworka, wspólne typy API/worker, dobry ekosystem RabbitMQ/SMTP/PDF.
- B: Python + FastAPI + SQLAlchemy — szybki development, ale gorsze współdzielenie typów z frontendem i mniejszy komfort przy długotrwałych workerach Node/PDF.
- C: Go + chi/sqlc — najlepsza wydajność, ale wolniejsze development i więcej kodu infrastrukturalnego dla małego zespołu.

**Decyzja:** Wybieram TypeScript + Fastify + Prisma.

**Uzasadnienie:** Średni ruch za rok to <1 klik/s, ale projektujemy na peaki ~25 req/s. Fastify bez problemu mieści się w budżecie 80ms, a Prisma wystarcza dla zapytań API i workerów przy tej skali.

**Konsekwencje:**
(+) Jeden język dla API, worker i większości kontraktów.
(+) Łatwy Docker Compose i szybkie wdrożenie.
(-) Prisma wymaga ostrożności przy ciężkich raportach i indeksach.

**Kiedy zrewidować:** Gdy redirect lub raporty przekraczają wymagania mimo cache/indeksów albo gdy ruch rośnie >100x.

## ADR-002 — PostgreSQL jako główna baza danych

**Status:** Zaakceptowana

**Kontekst:** System wymaga relacji między agencjami, klientami, kampaniami, linkami, kliknięciami i raportami oraz trwałości danych po restarcie Docker Compose.

**Problem:** Jak przechowywać dane żeby zapewnić spójność i obsłużyć miliony kliknięć?

**Opcje:**
- A: PostgreSQL — relacyjność, indeksy, transakcje, dobre zapytania analityczne dla v1, prosta administracja.
- B: ClickHouse + PostgreSQL — lepsza analityka przy dużej skali, ale więcej komponentów i większa złożoność.
- C: MongoDB — elastyczny schemat, ale słabszy fit dla relacji i raportów SQL.

**Decyzja:** Wybieram PostgreSQL 16.

**Uzasadnienie:** Szacowane ~13.2M kliknięć po roku to skala obsługiwana przez PostgreSQL z właściwymi indeksami. Dodatkowy silnik analityczny byłby overengineeringiem dla v1.

**Konsekwencje:**
(+) Prosta infrastruktura i spójne dane.
(+) Bezpieczne transakcje dla idempotencji i outbox.
(-) Przy większej skali może być potrzebna partycjonowanie `clicks` albo osobny magazyn analityczny.

**Kiedy zrewidować:** Gdy raporty/statystyki regularnie przekraczają akceptowalne czasy mimo indeksów.

## ADR-003 — Redis jako cache redirectu

**Status:** Zaakceptowana

**Kontekst:** Publiczny redirect ma limit <80ms i nie może zależeć od PostgreSQL przy każdym kliknięciu.

**Problem:** Jak zapewnić redirect <80ms bez przeciążania bazy?

**Opcje:**
- A: Redis cache short_code -> metadane linku — szybkie odczyty, TTL, prosty invalidation przy zmianach linku.
- B: PostgreSQL-only — prostsze, ale większa wariancja czasu i ryzyko przeciążenia raportami.

**Decyzja:** Wybieram Redis jako cache redirectu oraz negatywny cache 404.

**Uzasadnienie:** Cache hit w Redis to ~1-3ms i pozwala utrzymać redirect w ~10-30ms typowo. PostgreSQL pozostaje źródłem prawdy.

**Konsekwencje:**
(+) Stabilny redirect i mniejsze obciążenie bazy.
(+) Możliwość cache negatywnego dla botów/błędnych kodów.
(-) Trzeba invalidować cache przy zmianach linku/kampanii.

**Kiedy zrewidować:** Gdy Redis jest niestabilny lub potrzebny będzie cache rozproszony poza jednym VPS.

## ADR-004 — RabbitMQ jako broker kolejki

**Status:** Zaakceptowana

**Kontekst:** Dane kliknięć nie mogą ginąć, consumer musi mieć at-least-once delivery, retry i DLQ.

**Problem:** Jak zagwarantować at-least-once delivery kliknięć i nie blokować redirectu?

**Opcje:**
- A: RabbitMQ — durable queues, persistent messages, publish confirms, DLQ, management UI. Wada: osobny serwis.
- B: BullMQ (Redis) — mniej serwisów. Wada: Redis jako SPOF dla cache i kolejki.
- C: Kafka — bardzo duży throughput. Wada: overengineering przy aktualnej skali.

**Decyzja:** Wybieram RabbitMQ.

**Uzasadnienie:** RabbitMQ najlepiej pasuje do wymagań at-least-once i DLQ bez złożoności Kafki. Redis pozostaje tylko cache.

**Konsekwencje:**
(+) Trwałe kolejki, retry, DLQ i publish confirms.
(+) Lepsze rozdzielenie cache od event delivery.
(-) Jeden dodatkowy kontener i konfiguracja.

**Kiedy zrewidować:** Gdy throughput wzrośnie do poziomu, gdzie RabbitMQ staje się bottleneckiem lub potrzebny będzie event log.

## ADR-005 — SvelteKit jako frontend

**Status:** Zaakceptowana

**Kontekst:** V1 wymaga tylko web UI, bez mobile app, a jeden developer ma utrzymywać projekt.

**Problem:** Jak zbudować frontend żeby szybko dostarczyć dashboard, linki, statystyki i raporty?

**Opcje:**
- A: SvelteKit — prosty routing, mało boilerplate, szybki development, osobny kontener web.
- B: SolidStart — dobra wydajność i fine-grained reactivity, ale mniejsza dojrzałość operacyjna.
- C: React — największy ekosystem, ale więcej boilerplate niż potrzeba w v1.

**Decyzja:** Wybieram SvelteKit.

**Uzasadnienie:** SvelteKit redukuje złożoność UI i dobrze pasuje do jednego zespołu/developera oraz Docker Compose.

**Konsekwencje:**
(+) Szybkie tworzenie ekranów i prosty deployment.
(-) Mniejszy ekosystem gotowych komponentów niż React.

**Kiedy zrewidować:** Gdy projekt wymaga dużego zespołu frontendowego lub specyficznych bibliotek dostępnych tylko w React.

## ADR-006 — External GeoIP API i brak persystencji raw IP

**Status:** Zaakceptowana

**Kontekst:** Kliknięcia wymagają pełniejszej geolokalizacji z IP, ale v1 nie buduje własnej geolokalizacji i powinien ograniczać PII.

**Problem:** Jak geolokalizować IP bez blokowania redirectu i bez wiązania systemu z jednym vendorem?

**Opcje:**
- A: Provider-agnostic external GeoIP API — elastyczny vendor, łatwy start, bogatsze pola geo/ISP/ASN. Wada: latency, koszty, rate limits, przekazywanie IP do providera.
- B: Lokalny MaxMind GeoLite2 City DB — brak latency sieci i brak wysyłania IP do API zewnętrznego. Wada: mniej elastyczny setup i konieczna dystrybucja/aktualizacja pliku danych.
- C: Hard-coded provider — prosta implementacja. Wada: vendor lock-in w kontraktach.

**Decyzja:** Wybieram provider-agnostic external GeoIP API konfigurowany przez `GEOIP_PROVIDER`, `GEOIP_API_URL`, `GEOIP_API_KEY`, `GEOIP_TIMEOUT_MS`.

**Uzasadnienie:** Geo lookup działa wyłącznie w workerze, więc latency API nie wpływa na redirect <80ms. Kontrakt normalizuje odpowiedź providera i pozwala zmienić dostawcę bez zmiany eventów/API. Raw IP jest tylko w evencie i requestcie do providera; w PostgreSQL zapisujemy `ip_hash`.

**Konsekwencje:**
(+) Możliwość użycia różnych dostawców i bogatszych pól: region, lat/lon, timezone, ISP, ASN.
(+) Brak pliku GeoIP w repo i prostsze pierwsze uruchomienie.
(-) Zewnętrzna zależność, timeouty, rate limits i przekazywanie IP do providera.

**Kiedy zrewidować:** Gdy koszty/rate limits API są problemem albo wymagania prywatności wymuszą lokalną bazę.

## ADR-008 — Pełne device analytics z User-Agent

**Status:** Zaakceptowana

**Kontekst:** Dashboard i raporty wymagają nie tylko unikalności po hashach, ale realnej analityki urządzeń, przeglądarek i systemów.

**Problem:** Jak zapisywać device analytics bez persystowania raw User-Agent?

**Opcje:**
- A: Parsować User-Agent w workerze i zapisywać znormalizowane pola analytics oraz `user_agent_hash` — pełne dashboardy bez raw UA w bazie.
- B: Zapisywać tylko `user_agent_hash` — lepsza prywatność, ale brak pełnej analityki.
- C: Zapisywać raw User-Agent — najpełniejsze dane, ale większy problem prywatności i storage.

**Decyzja:** Wybieram parsowanie UA w workerze i zapis znormalizowanych pól analytics bez raw UA.

**Uzasadnienie:** Spełnia wymóg pełnej analityki urządzeń i nadal ogranicza persystencję danych surowych. Raw UA jest tylko w evencie, a PostgreSQL przechowuje `device_type`, vendor/model, browser/version, os/version, engine/version, CPU i hash.

**Konsekwencje:**
(+) Dashboard może pokazać pełne segmenty urządzeń, przeglądarek i systemów.
(+) `user_agent_hash` nadal wspiera unique clicks.
(-) Zmiana parsera w przyszłości nie przeliczy historycznych rekordów bez reprocessingu raw eventów, których nie persystujemy.

**Kiedy zrewidować:** Gdy potrzebny będzie reprocessing historycznych raw UA albo dokładniejsze fingerprinting analytics.

## ADR-007 — Lokalne przechowywanie PDF

**Status:** Zaakceptowana

**Kontekst:** Docker Compose na jednym VPS, brak DevOps i brak wymogu S3 w v1.

**Problem:** Gdzie przechowywać wygenerowane raporty PDF?

**Opcje:**
- A: Lokalny persistent volume `/app/storage/reports` — najprostsze w Docker Compose.
- B: S3-compatible storage — lepsze dla wielu serwerów, ale dodatkowa usługa.

**Decyzja:** Wybieram lokalny persistent volume i autoryzowany endpoint download.

**Uzasadnienie:** V1 działa na jednym VPS, raportów jest ~40-200 tygodniowo, lokalny storage jest wystarczający.

**Konsekwencje:**
(+) Prosty deployment i brak publicznych signed URL.
(-) Backup wolumenu jest obowiązkowy operacyjnie.

**Kiedy zrewidować:** Przy wielu instancjach API/worker albo potrzebie CDN/S3.
