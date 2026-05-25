# Kontrakt eventów — kolejka wiadomości

## Konfiguracja

```text
Broker:   RabbitMQ
Exchange: trackflow.events (typ: topic, durable)
DLX:      trackflow.dead (typ: topic, durable)

Kolejki:
  trackflow.clicks         routing key: click.recorded
  trackflow.reports        routing key: report.requested
  trackflow.notifications  routing key: notification.send
  trackflow.outbox         internal relay, bez publicznego publishera

DLQ:
  trackflow.dead.clicks
  trackflow.dead.reports
  trackflow.dead.notifications
```

Wszystkie wiadomości są persistent. Publisher używa confirm channel. Consumer ACK dopiero po trwałym zapisie skutku w PostgreSQL albo po wykryciu idempotentnego duplikatu.

## Format koperty (envelope)

```json
{
  "event_id": "uuid",
  "event_type": "click.recorded | report.requested | notification.send",
  "version": "1.0",
  "timestamp": "ISO8601",
  "payload": {}
}
```

## EVENT: click.recorded

**Publisher:** API Server (`GET /:short_code`)

**Consumer:** Worker

**Kiedy:** podczas redirectu, przed zakończeniem odpowiedzi 302, z dynamicznym budżetem publish confirm. Jeśli RabbitMQ nie działa, API zapisuje envelope do `event_outbox` i dalej zwraca 302.

**Gwarancja:** at-least-once

**Idempotency:** ten sam `event_id` może przyjść dwa razy; consumer musi sprawdzić `clicks.event_id`.

**Payload:**
```json
{
  "agency_id": "uuid",
  "client_id": "uuid",
  "campaign_id": "uuid",
  "link_id": "uuid",
  "short_code": "1X2-d4F",
  "clicked_at": "ISO8601",
  "ip_address": "192.168.1.10",
  "user_agent": "Mozilla/5.0...",
  "referrer": "string | null"
}
```

**Co robi consumer:**
```text
1. Sprawdź czy event_id istnieje w tabeli clicks.
   -> tak: ACK i zakończ.
2. Parsuj user_agent -> device_type, device_vendor, device_model, browser, browser_version, os, os_version, engine, engine_version, cpu_architecture.
3. Geolokalizuj ip_address przez external GeoIP API -> country, region, city, latitude, longitude, timezone, isp, asn.
4. Parsuj referrer/original_url query -> referrer_domain i UTM fields.
5. Oblicz ip_hash i user_agent_hash z solą.
6. W transakcji: zapisz clicks, ustaw links.last_clicked_at = max(current, clicked_at).
7. ACK.

Przy błędzie geo/UA/referrer parsing: zapisz null dla tych pól, nie failuj eventu.
Przy błędzie zapisu: NACK -> retry.
```

**Retry:** 3 próby, backoff: 1s -> 5s -> 30s -> DLQ.

## EVENT: report.requested

**Publisher:** API Server (`POST /api/reports`) albo Worker cron `weekly-report`

**Consumer:** Worker

**Payload:**
```json
{
  "report_id": "uuid",
  "agency_id": "uuid",
  "client_id": "uuid",
  "requested_by": "uuid | null",
  "type": "manual | weekly",
  "date_from": "ISO8601",
  "date_to": "ISO8601",
  "link_ids": ["uuid"]
}
```

**Co robi consumer:**
```text
1. Sprawdź report.status; jeśli done, ACK; jeśli processing stare >30 min, kontynuuj; inaczej ustaw processing.
2. Pobierz klienta, kampanie, linki i kliknięcia bezpośrednio z PostgreSQL w zakresie dat.
3. Wygeneruj PDF.
4. Zapisz PDF do /app/storage/reports/report_{report_id}.pdf.
5. Ustaw reports.status='done', file_path, completed_at.
6. Jeśli type=manual i requested_by != null, opublikuj notification.send type=report_ready.
7. Jeśli type=weekly, opublikuj notification.send type=weekly_report dla wszystkich client users klienta.
8. ACK.

Przy błędzie: ustaw reports.status='failed', error_message, completed_at; ACK jeśli błąd jest trwały, NACK jeśli infrastrukturalny.
```

**Retry:** 3 próby, backoff: 10s -> 60s -> 300s -> DLQ.

## EVENT: notification.send

**Publisher:** API Server dla password reset request, Worker dla raportów i alertów

**Consumer:** Worker (`trackflow.notifications`)

**Payload:**
```json
{
  "type": "report_ready | alert_no_clicks | weekly_report | password_reset_request",
  "agency_id": "uuid",
  "client_id": "uuid | null",
  "recipient_email": "string",
  "subject": "string",
  "template_data": {
    "report_id": "uuid | null",
    "link_id": "uuid | null",
    "short_code": "string | null",
    "client_name": "string | null",
    "campaign_name": "string | null",
    "requesting_user_email": "string | null",
    "download_url": "string | null"
  }
}
```

**Co robi consumer:**
```text
1. Renderuj prosty HTML/text e-mail na podstawie type i template_data.
2. Wyślij przez SMTP (Mailhog dev, SMTP prod).
3. ACK po sukcesie SMTP.
4. Przy błędzie SMTP: NACK -> retry.
```

**Retry:** 5 prób, backoff: 30s -> 2m -> 5m -> 15m -> 30m -> DLQ.

## Outbox relay

```text
Harmonogram: co 1 sekundę w workerze

Co robi:
1. Pobierz do 100 event_outbox where status='pending' order by created_at.
2. Opublikuj envelope do RabbitMQ z confirm.
3. Po confirm ustaw status='published'.
4. Przy błędzie zwiększ attempts, zapisz last_error; po 10 próbach status='failed'.
```

## Zadania cykliczne (cron)

### weekly-report

```text
Harmonogram: worker sprawdza co 5 minut agencje, których lokalny czas >= poniedziałek 08:00 i raport za poprzedni pełny tydzień nie został utworzony.
Tolerancja: max 15 minut.
Timezone: agencies.timezone, default Europe/Warsaw.

Co robi:
1. Dla każdej agencji oblicz poprzedni pełny tydzień: poniedziałek 00:00:00 -> niedziela 23:59:59.999 w timezone agencji.
2. Dla każdego klienta agencji utwórz reports(type='weekly', status='pending').
3. Opublikuj report.requested z requested_by=null.
4. Deduplikuj przez unique logic: jeden weekly report per agency_id/client_id/date_from/date_to/type.
```

### alert-no-clicks

```text
Harmonogram: */15 * * * * (co 15 minut)

Co robi:
1. Pobierz aktywne linki: links.status='active', campaigns.status='active', not expired, not deleted.
2. Wybierz linki, gdzie last_clicked_at < now() - 24h albo last_clicked_at is null i created_at < now() - 24h.
3. Dla każdego linku sprawdź alert_deliveries dla daty w timezone agencji.
4. Wyślij notification.send type=alert_no_clicks do link.created_by oraz wszystkich users.role='marketer' w agencji.
5. Nie wysyłaj do agency_admin, chyba że osobny użytkownik ma role marketer.
6. Zapisz alert_deliveries po opublikowaniu notification.send.

Deduplikacja: UNIQUE(link_id, alert_type, sent_for_date, recipient_email), raz dziennie per link per odbiorca.
```

## Dead-letter queue

```text
Kto monitoruje: developer/operator przez RabbitMQ Management UI i logi workera.
Co się dzieje: event po limitach retry trafia do trackflow.dead.* z oryginalnym payloadem i metadanymi błędu.
Możliwy reprocess: ręczne przeniesienie wiadomości z DLQ do właściwej kolejki po usunięciu przyczyny; idempotency chroni przed duplikatami.
```
