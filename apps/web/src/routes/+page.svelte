<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy } from 'svelte';
  import MetricList from './MetricList.svelte';
  import Panel from './Panel.svelte';
  import Table from './Table.svelte';
  import WorldMap from './WorldMap.svelte';

  const apiBase = import.meta.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const views = ['dashboard', 'clients', 'campaigns', 'links', 'stats', 'reports', 'users'] as const;

  type View = typeof views[number];
  type User = { id: string; agency_id: string; client_id: string | null; email: string; role: 'agency_admin' | 'marketer' | 'client' };
  type ApiError = { message?: string };

  let email = 'admin@test.com';
  let password = 'test123';
  let token = browser ? localStorage.getItem('trackflow.token') ?? '' : '';
  let currentUser: User | null = browser && token ? JSON.parse(localStorage.getItem('trackflow.user') ?? 'null') : null;
  let view: View = 'dashboard';
  let loading = false;
  let error = '';
  let notice = '';

  let dashboard: any = null;
  let agency: any = null;
  let users: any[] = [];
  let clients: any[] = [];
  let campaigns: any[] = [];
  let links: any[] = [];
  let reports: any[] = [];
  let stats: any = null;

  let filters = { client_id: '', date_from: '', date_to: '' };
  let selectedLinkId = '';
  let selectedStatsPeriod = 'day';

  let clientForm = { name: '' };
  let campaignForm = { client_id: '', name: '', status: 'active' };
  let linkForm = { client_id: '', campaign_id: '', original_url: 'https://example.com', expires_at: daysFromNow(90), status: 'active' };
  let reportForm = { client_id: '', date_from: daysAgo(7), date_to: nowInput() };
  let userForm = { email: '', password: 'test123', role: 'marketer', client_id: '', name: '' };

  let poller: ReturnType<typeof setInterval> | null = null;
  let reportEvents: EventSource | null = null;

  $: activeCampaigns = campaigns.filter((campaign) => campaign.status === 'active');
  $: if (!selectedLinkId && links[0]) selectedLinkId = links[0].id;
  $: if (!campaignForm.client_id && clients[0]) campaignForm.client_id = clients[0].id;
  $: if (!linkForm.client_id && clients[0]) linkForm.client_id = clients[0].id;
  $: if (!linkForm.campaign_id && activeCampaigns[0]) linkForm.campaign_id = activeCampaigns[0].id;
  $: if (!reportForm.client_id && clients[0]) reportForm.client_id = clients[0].id;

  if (token) loadAll();

  onDestroy(() => {
    if (poller) clearInterval(poller);
    reportEvents?.close();
  });

  async function login() {
    await run(async () => {
      const json = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
      token = json.token;
      currentUser = json.user;
      if (browser) {
        localStorage.setItem('trackflow.token', token);
        localStorage.setItem('trackflow.user', JSON.stringify(currentUser));
      }
      await loadAll();
      connectReportEvents();
    }, 'Logged in');
  }

  function logout() {
    token = '';
    currentUser = null;
    if (browser) {
      localStorage.removeItem('trackflow.token');
      localStorage.removeItem('trackflow.user');
    }
    reportEvents?.close();
    reportEvents = null;
    stopPolling();
  }

  async function request(path: string, options: RequestInit = {}, authed = true) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(authed && token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) }
    });
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const json = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error((json as ApiError).message ?? 'Request failed');
    return json;
  }

  async function run(action: () => Promise<void>, success?: string) {
    loading = true;
    error = '';
    notice = '';
    try {
      await action();
      if (success) notice = success;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function loadAll() {
    if (!token) return;
    const query = dashboardQuery();
    const canManageBusiness = currentUser?.role !== 'client';
    const currentClientId = currentUser?.client_id;
    [agency, dashboard, clients, campaigns, links, reports] = await Promise.all([
      request('/api/agencies/current'),
      request(`/api/dashboard${query}`),
      canManageBusiness ? request('/api/clients').then((r) => r.data ?? []) : currentClientId ? request(`/api/clients/${currentClientId}`).then((client) => [client]) : Promise.resolve([]),
      request('/api/campaigns').then((r) => r.data ?? []),
      request('/api/links').then((r) => r.data ?? []),
      request('/api/reports').then((r) => r.data ?? [])
    ]);
    if (currentUser?.role === 'agency_admin') users = await request('/api/users').then((r) => r.data ?? []);
    await loadStats();
    connectReportEvents();
    configurePolling();
  }

  async function loadStats() {
    if (!selectedLinkId) return;
    const params = new URLSearchParams({ period: selectedStatsPeriod });
    if (filters.date_from) params.set('date_from', new Date(filters.date_from).toISOString());
    if (filters.date_to) params.set('date_to', new Date(filters.date_to).toISOString());
    stats = await request(`/api/links/${selectedLinkId}/stats?${params}`);
  }

  async function createClient() {
    await run(async () => {
      await request('/api/clients', { method: 'POST', body: JSON.stringify(clientForm) });
      clientForm = { name: '' };
      await loadAll();
    }, 'Client created');
  }

  async function createCampaign() {
    await run(async () => {
      await request('/api/campaigns', { method: 'POST', body: JSON.stringify(campaignForm) });
      campaignForm = { client_id: campaignForm.client_id, name: '', status: 'active' };
      await loadAll();
    }, 'Campaign created');
  }

  async function updateCampaign(campaign: any, status: string) {
    await run(async () => {
      await request(`/api/campaigns/${campaign.id}`, { method: 'PATCH', body: JSON.stringify({ name: campaign.name, status }) });
      await loadAll();
    }, 'Campaign updated');
  }

  async function createLink() {
    await run(async () => {
      await request('/api/links', { method: 'POST', body: JSON.stringify({ ...linkForm, expires_at: new Date(linkForm.expires_at).toISOString() }) });
      linkForm = { ...linkForm, original_url: 'https://example.com', expires_at: daysFromNow(90), status: 'active' };
      await loadAll();
    }, 'Link created');
  }

  async function updateLink(link: any, status: string) {
    await run(async () => {
      await request(`/api/links/${link.id}`, { method: 'PATCH', body: JSON.stringify({ original_url: link.original_url, expires_at: link.expires_at, status }) });
      await loadAll();
    }, 'Link updated');
  }

  async function deleteLink(link: any) {
    await run(async () => {
      await request(`/api/links/${link.id}`, { method: 'DELETE' });
      await loadAll();
    }, 'Link deleted');
  }

  async function createReport() {
    await run(async () => {
      await request('/api/reports', { method: 'POST', body: JSON.stringify({ client_id: reportForm.client_id, link_ids: [], date_from: new Date(reportForm.date_from).toISOString(), date_to: new Date(reportForm.date_to).toISOString() }) });
      await loadReports();
    }, 'Report requested');
  }

  async function loadReports() {
    reports = await request('/api/reports').then((r) => r.data ?? []);
    configurePolling();
  }

  function configurePolling() {
    const hasPending = reports.some((report) => report.status !== 'done' && report.status !== 'failed');
    if (hasPending && !poller && !reportEvents) poller = setInterval(loadReports, 3000);
    if (!hasPending) stopPolling();
  }

  function connectReportEvents() {
    if (!browser || !token || reportEvents) return;
    reportEvents = new EventSource(`${apiBase}/api/events/reports?token=${encodeURIComponent(token)}`);
    reportEvents.addEventListener('reports.updated', (event) => {
      reports = JSON.parse((event as MessageEvent).data);
      stopPolling();
    });
    reportEvents.onerror = () => {
      reportEvents?.close();
      reportEvents = null;
      configurePolling();
    };
  }

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
  }

  async function createUser() {
    await run(async () => {
      await request('/api/users', { method: 'POST', body: JSON.stringify({ ...userForm, client_id: userForm.role === 'client' ? userForm.client_id : null, name: userForm.name || null }) });
      userForm = { email: '', password: 'test123', role: 'marketer', client_id: '', name: '' };
      await loadAll();
    }, 'User created');
  }

  async function deleteUser(user: any) {
    await run(async () => {
      await request(`/api/users/${user.id}`, { method: 'DELETE' });
      await loadAll();
    }, 'User deleted');
  }

  function dashboardQuery() {
    const params = new URLSearchParams();
    if (filters.client_id) params.set('client_id', filters.client_id);
    if (filters.date_from) params.set('date_from', new Date(filters.date_from).toISOString());
    if (filters.date_to) params.set('date_to', new Date(filters.date_to).toISOString());
    const value = params.toString();
    return value ? `?${value}` : '';
  }

  function downloadUrl(report: any) {
    return `${apiBase}/api/reports/${report.id}/download`;
  }

  function daysAgo(days: number) {
    const date = new Date(Date.now() - days * 86400000);
    return date.toISOString().slice(0, 16);
  }

  function daysFromNow(days: number) {
    const date = new Date(Date.now() + days * 86400000);
    return date.toISOString().slice(0, 16);
  }

  function nowInput() {
    return new Date().toISOString().slice(0, 16);
  }

  function clientName(id: string) {
    return clients.find((client) => client.id === id)?.name ?? id;
  }
</script>

<svelte:head><title>TrackFlow</title></svelte:head>

<main>
  <section class="hero">
    <div>
      <p class="eyebrow">TrackFlow v1</p>
      <h1>Fast campaign links, click analytics and PDF reports.</h1>
      {#if agency}<p class="subtle">{agency.name} · {agency.timezone}</p>{/if}
    </div>
    {#if token}<button on:click={() => run(loadAll, 'Refreshed')} disabled={loading}>Refresh</button>{/if}
  </section>

  {#if error}<p class="banner error">{error}</p>{/if}
  {#if notice}<p class="banner success">{notice}</p>{/if}

  {#if !token}
    <form class="card login" on:submit|preventDefault={login}>
      <div>
        <p class="eyebrow">Sign in</p>
        <h2>Access your agency workspace</h2>
      </div>
      <label>Email<input bind:value={email} autocomplete="email" /></label>
      <label>Password<input bind:value={password} type="password" autocomplete="current-password" /></label>
      <div class="actions">
        <button disabled={loading}>Login</button>
        <button type="button" class="ghost" on:click={() => run(() => request('/auth/password-reset-request', { method: 'POST', body: JSON.stringify({ email }) }, false), 'Reset request accepted')}>Password reset</button>
      </div>
    </form>
  {:else}
    <nav>
      {#each views as item}<button class:active={view === item} on:click={() => view = item}>{item}</button>{/each}
      <button class="ghost" on:click={logout}>Logout {currentUser?.email}</button>
    </nav>

    {#if view === 'dashboard'}
      <Panel title="Dashboard">
        <div class="filters">
          <label>Client<select bind:value={filters.client_id}><option value="">All clients</option>{#each clients as client}<option value={client.id}>{client.name}</option>{/each}</select></label>
          <label>From<input type="datetime-local" bind:value={filters.date_from} /></label>
          <label>To<input type="datetime-local" bind:value={filters.date_to} /></label>
          <button on:click={() => run(loadAll, 'Filters applied')}>Apply</button>
        </div>
        {#if dashboard}
          <div class="kpis">
            <article><span>Total links</span><strong>{dashboard.total_links}</strong></article>
            <article><span>Active links</span><strong>{dashboard.active_links}</strong></article>
            <article><span>Total clicks</span><strong>{dashboard.total_clicks}</strong></article>
            <article><span>Unique clicks</span><strong>{dashboard.unique_clicks}</strong></article>
          </div>
          <div class="grid two">
            <WorldMap countries={dashboard.by_country} />
            <MetricList title="Top links" rows={dashboard.top_links} label="short_code" value="clicks" />
            <MetricList title="Countries" rows={dashboard.by_country} label="country" value="count" />
            <MetricList title="Devices" rows={dashboard.by_device} label="device_type" value="count" />
            <MetricList title="Referrers" rows={dashboard.by_referrer} label="referrer" value="count" />
          </div>
        {/if}
      </Panel>
    {/if}

    {#if view === 'clients'}
      <Panel title="Clients">
        <form class="inline-form" on:submit|preventDefault={createClient}>
          <label>Name<input bind:value={clientForm.name} required /></label>
          <button disabled={loading}>Create client</button>
        </form>
        <Table rows={clients} />
      </Panel>
    {/if}

    {#if view === 'campaigns'}
      <Panel title="Campaigns">
        <form class="inline-form" on:submit|preventDefault={createCampaign}>
          <label>Client<select bind:value={campaignForm.client_id}>{#each clients as client}<option value={client.id}>{client.name}</option>{/each}</select></label>
          <label>Name<input bind:value={campaignForm.name} required /></label>
          <label>Status<select bind:value={campaignForm.status}><option>active</option><option>paused</option><option>archived</option></select></label>
          <button disabled={loading}>Create campaign</button>
        </form>
        <div class="cards">{#each campaigns as campaign}<article><h3>{campaign.name}</h3><p>{clientName(campaign.clientId)} · {campaign.status}</p><div class="actions"><button on:click={() => updateCampaign(campaign, 'active')}>Active</button><button class="ghost" on:click={() => updateCampaign(campaign, 'paused')}>Pause</button><button class="ghost" on:click={() => updateCampaign(campaign, 'archived')}>Archive</button></div></article>{/each}</div>
      </Panel>
    {/if}

    {#if view === 'links'}
      <Panel title="Links">
        <form class="inline-form" on:submit|preventDefault={createLink}>
          <label>Client<select bind:value={linkForm.client_id}>{#each clients as client}<option value={client.id}>{client.name}</option>{/each}</select></label>
          <label>Campaign<select bind:value={linkForm.campaign_id}>{#each campaigns.filter((c) => c.clientId === linkForm.client_id || c.client_id === linkForm.client_id) as campaign}<option value={campaign.id}>{campaign.name}</option>{/each}</select></label>
          <label>Original URL<input bind:value={linkForm.original_url} required /></label>
          <label>Expires<input type="datetime-local" bind:value={linkForm.expires_at} required /></label>
          <label>Status<select bind:value={linkForm.status}><option>active</option><option>inactive</option></select></label>
          <button disabled={loading}>Create link</button>
        </form>
        <div class="link-list">{#each links as link}<article><div><h3>{link.short_code}</h3><a href={link.short_url} target="_blank" rel="noreferrer">{link.short_url}</a><p>{link.original_url}</p></div><span class="pill">{link.status}</span><div class="actions"><button on:click={() => { selectedLinkId = link.id; view = 'stats'; loadStats(); }}>Stats</button><button class="ghost" on:click={() => updateLink(link, link.status === 'active' ? 'inactive' : 'active')}>Toggle</button><button class="danger" on:click={() => deleteLink(link)}>Delete</button></div></article>{/each}</div>
      </Panel>
    {/if}

    {#if view === 'stats'}
      <Panel title="Link stats">
        <div class="filters">
          <label>Link<select bind:value={selectedLinkId}>{#each links as link}<option value={link.id}>{link.short_code}</option>{/each}</select></label>
          <label>Period<select bind:value={selectedStatsPeriod}><option>hour</option><option>day</option><option>week</option></select></label>
          <button on:click={() => run(loadStats, 'Stats refreshed')}>Load stats</button>
        </div>
        {#if stats}
          <div class="kpis"><article><span>Total clicks</span><strong>{stats.total_clicks}</strong></article><article><span>Unique clicks</span><strong>{stats.unique_clicks}</strong></article></div>
          <div class="grid two"><WorldMap countries={stats.by_country} /><MetricList title="Timeline" rows={stats.clicks_over_time} label="timestamp" value="count" /><MetricList title="Cities" rows={stats.by_city} label="city" value="count" /><MetricList title="Browsers" rows={stats.by_browser} label="browser" value="count" /><MetricList title="OS" rows={stats.by_os} label="os" value="count" /></div>
        {/if}
      </Panel>
    {/if}

    {#if view === 'reports'}
      <Panel title="Reports">
        <form class="inline-form" on:submit|preventDefault={createReport}>
          <label>Client<select bind:value={reportForm.client_id}>{#each clients as client}<option value={client.id}>{client.name}</option>{/each}</select></label>
          <label>From<input type="datetime-local" bind:value={reportForm.date_from} /></label>
          <label>To<input type="datetime-local" bind:value={reportForm.date_to} /></label>
          <button disabled={loading}>Generate PDF</button>
        </form>
        <div class="cards">{#each reports as report}<article><h3>{report.type} report</h3><p>{clientName(report.client_id)} · <span class="pill">{report.status}</span></p><p>{new Date(report.date_from).toLocaleString()} - {new Date(report.date_to).toLocaleString()}</p>{#if report.status === 'done'}<a class="button" href={downloadUrl(report)} target="_blank" rel="noreferrer">Download PDF</a>{/if}{#if report.error_message}<p class="error">{report.error_message}</p>{/if}</article>{/each}</div>
      </Panel>
    {/if}

    {#if view === 'users'}
      <Panel title="Users">
        {#if currentUser?.role === 'agency_admin'}
          <form class="inline-form" on:submit|preventDefault={createUser}>
            <label>Email<input bind:value={userForm.email} type="email" required /></label>
            <label>Password<input bind:value={userForm.password} type="password" required /></label>
            <label>Role<select bind:value={userForm.role}><option>agency_admin</option><option>marketer</option><option>client</option></select></label>
            {#if userForm.role === 'client'}<label>Client<select bind:value={userForm.client_id}>{#each clients as client}<option value={client.id}>{client.name}</option>{/each}</select></label>{/if}
            <label>Name<input bind:value={userForm.name} /></label>
            <button disabled={loading}>Create user</button>
          </form>
          <div class="cards">{#each users as user}<article><h3>{user.email}</h3><p>{user.role} · {user.name ?? 'No name'}</p><button class="danger" on:click={() => deleteUser(user)}>Delete</button></article>{/each}</div>
        {:else}
          <p>Only agency admins can manage users.</p>
        {/if}
      </Panel>
    {/if}
  {/if}
</main>

<style>
  :global(body) { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0b1220; color: #f8fafc; }
  main { max-width: 1200px; margin: 0 auto; padding: 28px 18px 64px; }
  .hero { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: 38px; border-radius: 30px; background: radial-gradient(circle at top left, #1e7490, transparent 35%), linear-gradient(135deg, #14213d, #0d2f28); box-shadow: 0 24px 70px rgba(0,0,0,.28); }
  .eyebrow { color: #7dd3fc; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 800; }
  .subtle { color: #b6c6d8; }
  h1 { max-width: 780px; font-size: clamp(34px, 7vw, 74px); line-height: .92; margin: 0; letter-spacing: -.05em; }
  h2, h3 { margin-top: 0; }
  nav, .card { margin-top: 22px; padding: 18px; border-radius: 22px; background: rgba(23, 33, 43, .92); display: flex; flex-wrap: wrap; gap: 10px; border: 1px solid rgba(255,255,255,.08); }
  .login { display: grid; max-width: 520px; }
  label { display: grid; gap: 6px; color: #b6c6d8; font-size: 13px; font-weight: 700; }
  input, select, button, .button { border: 0; border-radius: 13px; padding: 12px 14px; font: inherit; }
  input, select { background: #0f1a2a; color: #f8fafc; border: 1px solid rgba(255,255,255,.08); min-width: 170px; }
  button, .button { background: #7dd3fc; color: #082f49; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
  button:disabled { opacity: .55; cursor: wait; }
  button.active { background: #fef08a; }
  .ghost { background: rgba(255,255,255,.08); color: #e2e8f0; }
  .danger { background: #fb7185; color: #450a0a; }
  .actions, .filters, .inline-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
  .inline-form { margin-bottom: 20px; padding: 16px; background: rgba(255,255,255,.04); border-radius: 18px; }
  .banner { padding: 14px 16px; border-radius: 16px; margin: 16px 0 0; font-weight: 800; }
  .error { color: #fecdd3; background: rgba(127, 29, 29, .45); }
  .success { color: #bbf7d0; background: rgba(20, 83, 45, .45); }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 18px 0; }
  .kpis article, .cards article, .link-list article { background: #0f1a2a; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 16px; }
  .kpis span { color: #93a4b8; font-size: 13px; }
  .kpis strong { display: block; font-size: 34px; margin-top: 8px; }
  .grid.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .link-list { display: grid; gap: 12px; }
  .link-list article { display: grid; grid-template-columns: 1fr auto auto; gap: 16px; align-items: center; }
  .link-list p { color: #93a4b8; overflow-wrap: anywhere; }
  .pill { background: rgba(125,211,252,.14); color: #bae6fd; border: 1px solid rgba(125,211,252,.3); border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 800; }
  @media (max-width: 800px) { .hero, .link-list article { grid-template-columns: 1fr; display: grid; } .kpis, .grid.two { grid-template-columns: 1fr; } input, select { min-width: 0; width: 100%; } }
</style>
