CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  client_id uuid NULL REFERENCES clients(id),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('agency_admin','marketer','client')),
  name text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (agency_id, email),
  CHECK ((role = 'client' AND client_id IS NOT NULL) OR (role IN ('agency_admin', 'marketer') AND client_id IS NULL))
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','paused','archived')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  short_code text UNIQUE NOT NULL CHECK (short_code ~ '^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$'),
  original_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','inactive')),
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  last_clicked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CHECK (expires_at <= created_at + interval '365 days')
);

CREATE TABLE clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid UNIQUE NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  link_id uuid NOT NULL REFERENCES links(id),
  short_code text NOT NULL,
  clicked_at timestamptz NOT NULL,
  country text NULL,
  region text NULL,
  city text NULL,
  latitude decimal(9,6) NULL,
  longitude decimal(9,6) NULL,
  timezone text NULL,
  isp text NULL,
  asn text NULL,
  device_type text NULL CHECK (device_type IS NULL OR device_type IN ('mobile','desktop','tablet')),
  device_vendor text NULL,
  device_model text NULL,
  browser text NULL,
  browser_version text NULL,
  os text NULL,
  os_version text NULL,
  engine text NULL,
  engine_version text NULL,
  cpu_architecture text NULL,
  referrer text NULL,
  referrer_domain text NULL,
  utm_source text NULL,
  utm_medium text NULL,
  utm_campaign text NULL,
  utm_term text NULL,
  utm_content text NULL,
  ip_hash text NULL,
  user_agent_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  requested_by uuid NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('manual','weekly')),
  status text NOT NULL CHECK (status IN ('pending','processing','done','failed')),
  date_from timestamptz NOT NULL,
  date_to timestamptz NOT NULL,
  link_ids uuid[] NOT NULL DEFAULT '{}',
  file_path text NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE TABLE alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  link_id uuid NOT NULL REFERENCES links(id),
  alert_type text NOT NULL CHECK (alert_type IN ('no_clicks_24h')),
  sent_for_date date NOT NULL,
  recipient_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, alert_type, sent_for_date, recipient_email)
);

CREATE TABLE event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid UNIQUE NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_agency_role_idx ON users(agency_id, role);
CREATE INDEX clients_agency_name_idx ON clients(agency_id, name);
CREATE INDEX campaigns_agency_client_status_idx ON campaigns(agency_id, client_id, status);
CREATE INDEX links_agency_client_campaign_idx ON links(agency_id, client_id, campaign_id);
CREATE INDEX links_status_expiry_deleted_idx ON links(status, expires_at, deleted_at);
CREATE INDEX links_last_clicked_idx ON links(last_clicked_at);
CREATE INDEX clicks_link_clicked_idx ON clicks(link_id, clicked_at);
CREATE INDEX clicks_client_clicked_idx ON clicks(client_id, clicked_at);
CREATE INDEX clicks_campaign_clicked_idx ON clicks(campaign_id, clicked_at);
CREATE INDEX clicks_unique_calc_idx ON clicks(link_id, ip_hash, user_agent_hash, clicked_at);
CREATE INDEX clicks_country_clicked_idx ON clicks(country, clicked_at);
CREATE INDEX clicks_device_clicked_idx ON clicks(device_type, clicked_at);
CREATE INDEX clicks_browser_clicked_idx ON clicks(browser, clicked_at);
CREATE INDEX clicks_os_clicked_idx ON clicks(os, clicked_at);
CREATE INDEX clicks_referrer_clicked_idx ON clicks(referrer_domain, clicked_at);
CREATE INDEX reports_agency_client_created_idx ON reports(agency_id, client_id, created_at);
CREATE INDEX reports_status_created_idx ON reports(status, created_at);
CREATE UNIQUE INDEX reports_weekly_dedupe_idx ON reports(agency_id, client_id, date_from, date_to) WHERE type = 'weekly';
CREATE INDEX outbox_status_created_idx ON event_outbox(status, created_at);
