import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

describe.skipIf(!runIntegration)('TrackFlow Docker Compose E2E', () => {
  it('covers auth, CRUD, redirect, stats, report PDF and client read access', async () => {
    const admin = await login('admin@test.com', 'test123');
    const clientSession = await login('client@test.com', 'test123');

    const suffix = randomUUID().slice(0, 8);
    const client = await api(admin.token, '/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Client ${suffix}` })
    });

    const campaign = await api(admin.token, '/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ client_id: client.id, name: `E2E Campaign ${suffix}`, status: 'active' })
    });

    const link = await api(admin.token, '/api/links', {
      method: 'POST',
      body: JSON.stringify({
        client_id: client.id,
        campaign_id: campaign.id,
        original_url: `https://example.com/e2e-${suffix}?utm_source=e2e&utm_medium=test&utm_campaign=${suffix}`,
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        status: 'active'
      })
    });

    expect(link.short_code).toMatch(/^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$/);

    const firstRedirect = await timedRedirect(link.short_url);
    expect(firstRedirect.status).toBe(302);
    expect(firstRedirect.location).toBe(link.original_url);

    const cachedRedirect = await timedRedirect(link.short_url);
    expect(cachedRedirect.status).toBe(302);
    expect(cachedRedirect.ms).toBeLessThan(80);

    const stats = await waitFor(async () => {
      const body = await api(admin.token, `/api/links/${link.id}/stats?period=day`);
      return body.total_clicks >= 2 ? body : null;
    }, 5000);
    expect(stats.unique_clicks).toBeGreaterThan(0);
    expect(stats.by_referrer).toBeDefined();

    const dashboard = await api(admin.token, `/api/dashboard?client_id=${client.id}`);
    expect(dashboard.total_links).toBeGreaterThanOrEqual(1);
    expect(dashboard.total_clicks).toBeGreaterThanOrEqual(2);

    const clientDashboard = await api(clientSession.token, '/api/dashboard');
    expect(clientDashboard.total_links).toBeGreaterThanOrEqual(1);

    const reportRequest = await api(admin.token, '/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        client_id: client.id,
        link_ids: [link.id],
        date_from: new Date(Date.now() - 86400000).toISOString(),
        date_to: new Date(Date.now() + 60000).toISOString()
      })
    });

    const report = await waitFor(async () => {
      const body = await api(admin.token, `/api/reports/${reportRequest.report_id}`);
      return body.status === 'done' ? body : null;
    }, 10000);
    expect(report.download_url).toBe(`/api/reports/${report.id}/download`);

    const sse = await readReportsSse(admin.token);
    expect(sse.some((item: { id: string }) => item.id === report.id)).toBe(true);

    const pdf = await fetch(`${apiBase}/api/reports/${report.id}/download`, { headers: authHeaders(admin.token) });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(500);
  }, 30000);

  it('falls back to text 404 for missing redirect codes', async () => {
    const response = await fetch(`${apiBase}/BAD-404`, { redirect: 'manual' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('Link not found');
  });
});

async function login(email: string, password: string) {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ token: string; user: unknown }>;
}

async function api(token: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...authHeaders(token), 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  if (response.status === 204) return null;
  const json = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(json)}`);
  return json;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function timedRedirect(url: string) {
  const started = performance.now();
  const response = await fetch(url, { redirect: 'manual', headers: { referer: 'https://instagram.com/e2e' } });
  return { status: response.status, location: response.headers.get('location'), ms: performance.now() - started };
}

async function readReportsSse(token: string) {
  const response = await fetch(`${apiBase}/api/events/reports?token=${encodeURIComponent(token)}`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/event: reports\.updated\ndata: (.+)\n\n/s);
    if (match?.[1]) {
      await reader.cancel();
      return JSON.parse(match[1]);
    }
  }
  await reader.cancel();
  throw new Error('SSE reports.updated event not received');
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
