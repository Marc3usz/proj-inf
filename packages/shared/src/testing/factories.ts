import type { ClickRecordedPayload } from '../contracts/events.js';

export const TEST_AGENCY_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_CLIENT_ID = '22222222-2222-4222-8222-222222222222';
export const TEST_CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
export const TEST_LINK_ID = '44444444-4444-4444-8444-444444444444';
export const TEST_USER_ID = '55555555-5555-4555-8555-555555555555';

export function makeClickRecordedPayload(
  overrides: Partial<ClickRecordedPayload> = {}
): ClickRecordedPayload {
  return {
    agency_id: TEST_AGENCY_ID,
    client_id: TEST_CLIENT_ID,
    campaign_id: TEST_CAMPAIGN_ID,
    link_id: TEST_LINK_ID,
    short_code: '1X2-d4F',
    clicked_at: '2026-05-25T10:00:00.000Z',
    ip_address: '192.168.1.10',
    user_agent: 'Mozilla/5.0',
    referrer: 'https://example.com',
    ...overrides
  };
}
