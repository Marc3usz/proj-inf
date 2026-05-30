import { createHash } from 'node:crypto';
import { UAParser } from 'ua-parser-js';

export function parseUserAgent(userAgent: string | null | undefined) {
  try {
    if (!userAgent || userAgent.startsWith('Unknown')) return emptyUa();
    const parsed = new UAParser(userAgent).getResult();
    const type = parsed.device.type === 'mobile' || parsed.device.type === 'tablet' ? parsed.device.type : 'desktop';
    return {
      deviceType: type,
      deviceVendor: parsed.device.vendor ?? null,
      deviceModel: parsed.device.model ?? null,
      browser: parsed.browser.name ?? null,
      browserVersion: parsed.browser.version ?? null,
      os: parsed.os.name ?? null,
      osVersion: parsed.os.version ?? null,
      engine: parsed.engine.name ?? null,
      engineVersion: parsed.engine.version ?? null,
      cpuArchitecture: parsed.cpu.architecture ?? null
    };
  } catch {
    return emptyUa();
  }
}

export function emptyUa() {
  return { deviceType: null, deviceVendor: null, deviceModel: null, browser: null, browserVersion: null, os: null, osVersion: null, engine: null, engineVersion: null, cpuArchitecture: null };
}

export function parseReferrerAndUtm(referrer: string | null, originalUrl: string | null) {
  const sourceUrls = [originalUrl, referrer].filter(Boolean) as string[];
  const utm = { utmSource: null as string | null, utmMedium: null as string | null, utmCampaign: null as string | null, utmTerm: null as string | null, utmContent: null as string | null };
  for (const value of sourceUrls) {
    try {
      const url = new URL(value);
      utm.utmSource ??= url.searchParams.get('utm_source');
      utm.utmMedium ??= url.searchParams.get('utm_medium');
      utm.utmCampaign ??= url.searchParams.get('utm_campaign');
      utm.utmTerm ??= url.searchParams.get('utm_term');
      utm.utmContent ??= url.searchParams.get('utm_content');
    } catch {}
  }
  let referrerDomain: string | null = null;
  if (referrer) {
    try { referrerDomain = new URL(referrer).hostname.replace(/^www\./, ''); } catch {}
  }
  return { referrerDomain, ...utm };
}

export async function lookupGeo(ip: string, config: { url: string; key?: string; timeoutMs: number }, fetcher: typeof fetch = fetch) {
  if (!config.url || config.url.includes('example-geoip-provider.local')) return emptyGeo();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const url = new URL(config.url);
    url.searchParams.set('ip', ip);
    const response = await Promise.race([
      fetcher(url, { headers: config.key ? { Authorization: `Bearer ${config.key}` } : {}, signal: controller.signal }),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('geo timeout')), config.timeoutMs))
    ]);
    if (!response.ok) return emptyGeo();
    const data = await response.json() as any;
    return { country: data.country ?? data.country_code ?? null, region: data.region ?? null, city: data.city ?? null, latitude: data.latitude ?? data.lat ?? null, longitude: data.longitude ?? data.lon ?? null, timezone: data.timezone ?? null, isp: data.isp ?? null, asn: data.asn ? String(data.asn) : null };
  } catch {
    return emptyGeo();
  } finally {
    clearTimeout(timeout);
  }
}

export function emptyGeo() {
  return { country: null, region: null, city: null, latitude: null, longitude: null, timezone: null, isp: null, asn: null };
}

export function hash(value: string | null | undefined, salt: string) {
  if (!value) return null;
  return createHash('sha256').update(salt).update(':').update(value).digest('hex');
}

export function localDateKey(date: Date, timezone = 'Europe/Warsaw') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
