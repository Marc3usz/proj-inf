import { describe, expect, it, vi } from 'vitest';
import { generateShortCode, isShortCode, previousFullWeekWarsaw } from '@trackflow/shared';
import { lookupGeo, parseReferrerAndUtm, parseUserAgent } from './parsers.js';

describe('worker parsers', () => {
  it('parses iPhone user agent', () => {
    const parsed = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    expect(parsed.deviceType).toBe('mobile');
    expect(parsed.browser).toBeTruthy();
    expect(parsed.os).toBe('iOS');
  });

  it('returns null analytics for unknown UA', () => {
    expect(parseUserAgent('Unknown')).toMatchObject({ deviceType: null, browser: null, os: null });
  });

  it('does not throw on geo timeout', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await expect(lookupGeo('127.0.0.1', { url: 'https://geo.test', timeoutMs: 1 }, fetcher)).resolves.toMatchObject({ country: null });
  });

  it('extracts referrer domain and UTM fields', () => {
    expect(parseReferrerAndUtm('https://www.instagram.com/p/1?utm_source=ig', 'https://example.com/?utm_medium=email&utm_campaign=spring')).toMatchObject({ referrerDomain: 'instagram.com', utmSource: 'ig', utmMedium: 'email', utmCampaign: 'spring' });
  });

  it('generates Base62 short codes', () => {
    expect(isShortCode(generateShortCode())).toBe(true);
  });

  it('calculates previous full week in Warsaw', () => {
    const range = previousFullWeekWarsaw(new Date('2026-05-25T06:05:00.000Z'));
    expect(range.date_from.toISOString()).toBe('2026-05-17T22:00:00.000Z');
    expect(range.date_to.toISOString()).toBe('2026-05-24T21:59:59.999Z');
  });
});
