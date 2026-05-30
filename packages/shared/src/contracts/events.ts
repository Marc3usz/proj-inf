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
