# Model danych — TrackFlow

## Zasady

- Każda tabela ma `id uuid PK`, `created_at timestamptz NOT NULL DEFAULT now()`.
- Klucze główne używają UUID, bo eventy, API i kolejki wymagają stabilnych identyfikatorów bez ujawniania sekwencji.
- Soft delete stosujemy dla encji biznesowych, których historia musi zostać w raportach: `agencies`, `users`, `clients`, `campaigns`, `links`.
- Raw IP i raw User-Agent nie są persystowane w PostgreSQL. Zapisujemy `ip_hash`, `user_agent_hash` oraz znormalizowane pola geo/device/referrer analytics.
- Wszystkie dane biznesowe poza publicznym redirectem są filtrowane przez `agency_id`.

## Tabela: agencies

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id agencji. |
| name | text | NOT NULL | Nazwa agencji. |
| slug | text | UNIQUE, NOT NULL | Stabilny identyfikator w URL/admin UI. |
| timezone | text | NOT NULL, DEFAULT 'Europe/Warsaw' | IANA timezone dla cronów i raportów. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| updated_at | timestamptz | NOT NULL | Data aktualizacji. |
| deleted_at | timestamptz | NULL | Soft delete. |

## Tabela: users

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id użytkownika. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Agencja użytkownika. |
| client_id | uuid | FK -> clients.id, NULL | Wymagane dla `role=client`, null dla admin/marketer. |
| email | text | NOT NULL | E-mail logowania. Unikalny w ramach agencji. |
| password_hash | text | NOT NULL | Hash hasła. |
| role | text | NOT NULL, enum: agency_admin/marketer/client | Rola uprawnień. |
| name | text | NULL | Imię/nazwa wyświetlana. |
| is_active | boolean | NOT NULL, DEFAULT true | Czy może się logować. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| updated_at | timestamptz | NOT NULL | Data aktualizacji. |
| deleted_at | timestamptz | NULL | Soft delete. |

Constrainty:

- `UNIQUE (agency_id, email)`.
- `CHECK ((role = 'client' AND client_id IS NOT NULL) OR (role IN ('agency_admin', 'marketer') AND client_id IS NULL))`.

## Tabela: clients

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id klienta agencji. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Agencja właściciel. |
| name | text | NOT NULL | Nazwa klienta. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| updated_at | timestamptz | NOT NULL | Data aktualizacji. |
| deleted_at | timestamptz | NULL | Soft delete. |

## Tabela: campaigns

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id kampanii. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Agencja właściciel. |
| client_id | uuid | FK -> clients.id, NOT NULL | Klient kampanii. |
| name | text | NOT NULL | Nazwa kampanii. |
| status | text | NOT NULL, enum: active/paused/archived | Status kampanii. |
| created_by | uuid | FK -> users.id, NOT NULL | Twórca kampanii. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| updated_at | timestamptz | NOT NULL | Data aktualizacji. |
| deleted_at | timestamptz | NULL | Soft delete. |

## Tabela: links

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id linku. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Agencja właściciel. |
| client_id | uuid | FK -> clients.id, NOT NULL | Klient linku. |
| campaign_id | uuid | FK -> campaigns.id, NOT NULL | Kampania linku. |
| short_code | text | UNIQUE, NOT NULL | Format Base62 `XXX-XXX`, np. `1X2-d4F`. Globalnie unikalny. |
| original_url | text | NOT NULL | Docelowy URL. |
| status | text | NOT NULL, enum: active/inactive | Status linku. |
| created_by | uuid | FK -> users.id, NOT NULL | Użytkownik tworzący link. |
| expires_at | timestamptz | NOT NULL | Maksymalnie `created_at + 365 days`. |
| last_clicked_at | timestamptz | NULL | Ostatnie zapisane kliknięcie. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| updated_at | timestamptz | NOT NULL | Data aktualizacji. |
| deleted_at | timestamptz | NULL | Soft delete. |

Constrainty:

- `CHECK (expires_at <= created_at + interval '365 days')`.
- `CHECK (short_code ~ '^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$')`.

## Tabela: clicks

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id kliknięcia. |
| event_id | uuid | UNIQUE, NOT NULL | Idempotency key z eventu. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Denormalizacja pod raporty i autoryzację. |
| client_id | uuid | FK -> clients.id, NOT NULL | Denormalizacja pod raporty klienta. |
| campaign_id | uuid | FK -> campaigns.id, NOT NULL | Denormalizacja pod statystyki kampanii. |
| link_id | uuid | FK -> links.id, NOT NULL | Link kliknięcia. |
| short_code | text | NOT NULL | Kod klikniętego linku w momencie eventu. |
| clicked_at | timestamptz | NOT NULL | Czas kliknięcia. |
| country | text | NULL | ISO country code z external GeoIP API. |
| region | text | NULL | Region/województwo z GeoIP. |
| city | text | NULL | Miasto z GeoIP. |
| latitude | decimal(9,6) | NULL | Szerokość geograficzna. |
| longitude | decimal(9,6) | NULL | Długość geograficzna. |
| timezone | text | NULL | Timezone IP z GeoIP. |
| isp | text | NULL | ISP z GeoIP, jeśli provider zwraca. |
| asn | text | NULL | ASN z GeoIP, jeśli provider zwraca. |
| device_type | text | NULL, enum: mobile/desktop/tablet | Typ urządzenia z UA. |
| device_vendor | text | NULL | Producent urządzenia z UA. |
| device_model | text | NULL | Model urządzenia z UA. |
| browser | text | NULL | Przeglądarka z UA. |
| browser_version | text | NULL | Wersja przeglądarki z UA. |
| os | text | NULL | System operacyjny z UA. |
| os_version | text | NULL | Wersja systemu operacyjnego z UA. |
| engine | text | NULL | Silnik przeglądarki z UA. |
| engine_version | text | NULL | Wersja silnika przeglądarki z UA. |
| cpu_architecture | text | NULL | Architektura CPU z UA, jeśli rozpoznana. |
| referrer | text | NULL | Referrer z requestu. |
| referrer_domain | text | NULL | Domena referrera do top referrers. |
| utm_source | text | NULL | UTM source z docelowego URL lub referrera, jeśli obecny. |
| utm_medium | text | NULL | UTM medium. |
| utm_campaign | text | NULL | UTM campaign. |
| utm_term | text | NULL | UTM term. |
| utm_content | text | NULL | UTM content. |
| ip_hash | text | NULL | Hash IP z solą. |
| user_agent_hash | text | NULL | Hash User-Agent z solą. |
| created_at | timestamptz | NOT NULL | Data zapisu rekordu. |

## Tabela: reports

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id raportu. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Agencja raportu. |
| client_id | uuid | FK -> clients.id, NOT NULL | Klient raportu. |
| requested_by | uuid | FK -> users.id, NULL | Marketer/admin dla raportu ręcznego; null dla crona. |
| type | text | NOT NULL, enum: manual/weekly | Typ raportu. |
| status | text | NOT NULL, enum: pending/processing/done/failed | Status generowania. |
| date_from | timestamptz | NOT NULL | Początek zakresu. |
| date_to | timestamptz | NOT NULL | Koniec zakresu. |
| link_ids | uuid[] | NULL | Opcjonalny filtr linków dla raportu ręcznego. |
| file_path | text | NULL | Ścieżka PDF po wygenerowaniu. |
| error_message | text | NULL | Błąd generowania. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| completed_at | timestamptz | NULL | Data zakończenia. |

## Tabela: alert_deliveries

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id alertu. |
| agency_id | uuid | FK -> agencies.id, NOT NULL | Agencja. |
| link_id | uuid | FK -> links.id, NOT NULL | Link bez kliknięć. |
| alert_type | text | NOT NULL, enum: no_clicks_24h | Typ alertu. |
| sent_for_date | date | NOT NULL | Data deduplikacji w timezone agencji. |
| recipient_email | text | NOT NULL | Odbiorca. |
| created_at | timestamptz | NOT NULL | Kiedy utworzono. |

Constraint: `UNIQUE (link_id, alert_type, sent_for_date, recipient_email)`.

## Tabela: event_outbox

| Kolumna | Typ | Ograniczenia | Opis |
|---------|-----|--------------|------|
| id | uuid | PK | Id rekordu outbox. |
| event_id | uuid | UNIQUE, NOT NULL | Id eventu do publikacji. |
| event_type | text | NOT NULL | Typ eventu. |
| payload | jsonb | NOT NULL | Pełny envelope eventu. |
| status | text | NOT NULL, enum: pending/published/failed | Status publikacji. |
| attempts | integer | NOT NULL, DEFAULT 0 | Liczba prób publikacji. |
| last_error | text | NULL | Ostatni błąd. |
| created_at | timestamptz | NOT NULL | Data utworzenia. |
| updated_at | timestamptz | NOT NULL | Data aktualizacji. |

## Relacje

```text
agencies  1--* users
agencies  1--* clients
agencies  1--* campaigns
agencies  1--* links
clients   1--* users       (tylko role client)
clients   1--* campaigns
clients   1--* links
campaigns 1--* links
links     1--* clicks
clients   1--* reports
links     1--* alert_deliveries
```

## Co NIE idzie do PostgreSQL

| Co | Gdzie | Dlaczego nie w PG |
|----|-------|-------------------|
| Cache redirectu (short_code -> metadane linku) | Redis | Szybki lookup <80ms i mniejsze obciążenie PG. |
| Negatywny cache 404 | Redis | Ochrona PG przed powtarzalnymi błędnymi/botowymi kodami. |
| Raw IP po przetworzeniu | Nigdzie trwale | Minimalizacja PII; w PG tylko hash. |
| Pliki PDF | Persistent volume `/app/storage/reports` | PostgreSQL trzyma metadane, filesystem trzyma binaria. |
| Raw User-Agent | Tylko event w RabbitMQ/outbox do czasu przetworzenia | W PG trzymamy pełne znormalizowane analytics i hash, bez raw UA. |
| External GeoIP provider response | Nie persystujemy surowej odpowiedzi | W PG trzymamy tylko znormalizowane pola geo. |
