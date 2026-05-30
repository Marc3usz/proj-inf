import { describe, expect, it } from 'vitest';
import {
  TEST_AGENCY_ID,
  TEST_CAMPAIGN_ID,
  TEST_CLIENT_ID,
  TEST_LINK_ID,
  makeClickRecordedPayload
} from './factories.js';

describe('test factories', () => {
  it('creates click.recorded payloads matching the event contract shape', () => {
    const payload = makeClickRecordedPayload({ referrer: null, short_code: '1X2-d4F' });

    expect(payload).toEqual({
      agency_id: TEST_AGENCY_ID,
      client_id: TEST_CLIENT_ID,
      campaign_id: TEST_CAMPAIGN_ID,
      link_id: TEST_LINK_ID,
      short_code: '1X2-d4F',
      clicked_at: '2026-05-25T10:00:00.000Z',
      ip_address: '192.168.1.10',
      user_agent: 'Mozilla/5.0',
      referrer: null
    });
  });
});
