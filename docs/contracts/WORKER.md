# Kontrakt Workera

Worker to osobny proces, który konsumuje eventy, publikuje outbox i uruchamia crony. Nie obsługuje requestów HTTP.

## Odpowiedzialności

- [x] Consumer: `click.recorded`
- [x] Consumer: `report.requested`
- [x] Consumer: `notification.send`
- [x] Relay: `event_outbox` -> RabbitMQ
- [x] Cron: `weekly-report` (poniedziałek 8:00 w timezone agencji, sprawdzane co 5 minut)
- [x] Cron: `alert-no-clicks` (co 15 minut)

## Integracje

### Geolokalizacja IP

```text
Provider:    provider-agnostic external GeoIP API
Config:      GEOIP_PROVIDER, GEOIP_API_URL, GEOIP_API_KEY, GEOIP_TIMEOUT_MS
Timeout:     domyślnie 750ms w workerze
Retry:       1 retry tylko dla błędów sieciowych/5xx, bez blokowania ACK dłużej niż timeout
Fields:      country, region, city, latitude, longitude, timezone, isp, asn
Fallback:    przy błędzie lub timeout zapisz null dla pól geo i nie failuj eventu
Redirect:    nigdy nie wywołuj GeoIP API w endpointcie GET /:short_code
```

### Parser User-Agent

```text
Biblioteka:  ua-parser-js
Pola:        device_type, device_vendor, device_model, browser, browser_version, os, os_version, engine, engine_version, cpu_architecture
Fallback:    nieznany User-Agent -> null dla nierozpoznanych pól, bez wyjątku
Storage:     raw User-Agent nie trafia do PostgreSQL; zapisujemy znormalizowane pola i user_agent_hash
```

### Parser referrer/UTM

```text
Pola:        referrer, referrer_domain, utm_source, utm_medium, utm_campaign, utm_term, utm_content
Źródło UTM:  query params z original_url lub referrer URL, jeśli obecne
Fallback:    błędny URL/referrer -> null dla pól pochodnych, bez wyjątku
```

### Generowanie PDF

```text
Biblioteka:       Playwright Chromium lub Puppeteer
Gdzie zapisujesz: /app/storage/reports
Format nazwy:     report_{report_id}.pdf
Po wygenerowaniu: reports.status='done', file_path, completed_at; publikuj notification.send jeśli wymagane
```

### Wysyłanie e-maili

```text
Biblioteka: nodemailer
Dev:        Mailhog — lokalny SMTP, UI: http://localhost:8025
Prod:       generic SMTP
From:       SMTP_FROM, domyślnie noreply@trackflow.io
```

## Zmienne środowiskowe

```env
NODE_ENV=production
DATABASE_URL=postgresql://trackflow:trackflow@postgres:5432/trackflow
RABBITMQ_URL=amqp://trackflow:trackflow@rabbitmq:5672
REDIS_URL=redis://redis:6379
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
IP_HASH_SALT=change-me
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000
```

## Worker behavior

### click.recorded

- Consumer musi być idempotentny przez `clicks.event_id`.
- ACK dopiero po transakcji zapisu `clicks` i aktualizacji `links.last_clicked_at`.
- Błędy UA/Geo/referrer parsing nie powodują NACK.
- Błędy PostgreSQL powodują NACK i retry.

### report.requested

- Raporty czytają bezpośrednio z `clicks`; brak tabel agregatów w v1.
- PDF zapisany lokalnie, metadane w `reports`.
- Raport weekly obejmuje poprzedni pełny tydzień kalendarzowy w timezone agencji.

### notification.send

- Wysyłka przez SMTP.
- Password reset request trafia do wszystkich `agency_admin` w agencji użytkownika.
- No-click alert trafia do `link.created_by` i wszystkich użytkowników `role=marketer` w agencji.
- Weekly report trafia do wszystkich użytkowników `role=client` przypisanych do klienta.

## Testy które agent musi napisać

### Jednostkowe

- [ ] Parser UA: iPhone -> device_type: `mobile`, vendor/model/browser/os jeśli rozpoznane
- [ ] Parser UA: nieznany -> null dla pól analytics, nie rzuca wyjątku
- [ ] Idempotency: drugi event z tym samym `event_id` jest ignorowany
- [ ] Geolokalizacja: timeout API -> null dla pól geo, nie rzuca wyjątku
- [ ] Referrer/UTM parser: wyciąga `referrer_domain` i UTM fields
- [ ] Short code generator: format `XXX-XXX`, Base62 only
- [ ] Weekly report period: poprzedni poniedziałek-niedziela w timezone agencji
- [ ] No-click alert dedupe: raz dziennie per link per odbiorca

### Integracyjne

- [ ] `click.recorded` -> rekord w tabeli `clicks`
- [ ] Ten sam `event_id` dwa razy -> jeden rekord
- [ ] RabbitMQ down przy redirect -> event zapisany w `event_outbox`
- [ ] Outbox relay -> publikuje pending event i oznacza `published`
- [ ] `report.requested` -> plik PDF istnieje + `reports.status = done`
- [ ] `weekly-report` -> e-mail w Mailhogu do client users
- [ ] `alert-no-clicks` -> e-mail do created_by i marketerów, bez agency_admin
