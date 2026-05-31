import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { generateShortCode, isShortCode, type ClickRecordedPayload, type NotificationSendPayload, type ReportRequestedPayload } from '@trackflow/shared';
import { hashPassword, signJwt, verifyJwt, verifyPassword, type JwtUser } from './auth.js';
import { EventPublisher } from './events.js';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
const publisher = new EventPublisher(process.env.RABBITMQ_URL ?? 'amqp://trackflow:trackflow@localhost:5672', prisma);
const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-prod';
const shortUrlBase = process.env.PUBLIC_SHORT_URL_BASE;

type RequestWithUser = FastifyRequest & { user?: JwtUser };
type Role = JwtUser['role'];

const app = Fastify({ logger: true, trustProxy: true });

app.addHook('onRequest', async (request, reply) => {
  setCorsHeaders(request, reply);
  if (request.method === 'OPTIONS') return reply.status(204).send();
});

app.addHook('onSend', async (request, reply, payload) => {
  setCorsHeaders(request, reply);
  return payload;
});

app.options('*', async (request, reply) => {
  setCorsHeaders(request, reply);
  return reply.status(204).send();
});

app.setNotFoundHandler((request, reply) => {
  setCorsHeaders(request, reply);
  return reply.status(404).send({ code: 'NOT_FOUND', message: 'Not found' });
});

app.setErrorHandler((error, request, reply) => {
  setCorsHeaders(request, reply);
  app.log.error(error);
  if (error instanceof z.ZodError) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: error.errors[0]?.message ?? 'Validation error' });
  return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
});

app.get('/healthz', async () => ({ status: 'ok' }));

app.post('/auth/login', async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
  const user = await prisma.user.findFirst({ where: { email: body.email, deletedAt: null, isActive: true } });
  if (!user || !verifyPassword(body.password, user.passwordHash)) return reply.status(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
  const jwtUser: JwtUser = { id: user.id, agency_id: user.agencyId, client_id: user.clientId, email: user.email, role: user.role as Role };
  return { token: signJwt(jwtUser, jwtSecret), user: jwtUser };
});

app.post('/auth/password-reset-request', async (request, reply) => {
  const body = z.object({ email: z.string().email() }).parse(request.body);
  const user = await prisma.user.findFirst({ where: { email: body.email, deletedAt: null }, include: { agency: true } });
  if (user) {
    const admins = await prisma.user.findMany({ where: { agencyId: user.agencyId, role: 'agency_admin', deletedAt: null, isActive: true } });
    await Promise.all(admins.map((admin) => publisher.publish<'notification.send', NotificationSendPayload>('notification.send', {
      type: 'password_reset_request', agency_id: user.agencyId, client_id: user.clientId, recipient_email: admin.email,
      subject: `Password reset request for ${user.email}`,
      template_data: emptyTemplate({ requesting_user_email: user.email })
    })));
  }
  return reply.status(202).send({ status: 'accepted' });
});

app.get('/api/agencies/current', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request) => {
  const user = (request as RequestWithUser).user!;
  return prisma.agency.findFirstOrThrow({ where: { id: user.agency_id, deletedAt: null }, select: { id: true, name: true, slug: true, timezone: true } });
});

app.patch('/api/agencies/current', { preHandler: auth(['agency_admin']) }, async (request) => {
  const user = (request as RequestWithUser).user!;
  const body = z.object({ name: z.string().min(1), timezone: z.string().min(1) }).parse(request.body);
  return prisma.agency.update({ where: { id: user.agency_id }, data: body, select: { id: true, name: true, slug: true, timezone: true } });
});

app.get('/api/users', { preHandler: auth(['agency_admin']) }, async (request) => {
  const user = (request as RequestWithUser).user!;
  const { page, limit, skip } = pagination(request.query);
  const q = z.object({ role: z.string().optional(), client_id: z.string().optional(), search: z.string().optional() }).passthrough().parse(request.query);
  const where = { agencyId: user.agency_id, deletedAt: null, ...(q.role ? { role: q.role } : {}), ...(q.client_id ? { clientId: q.client_id } : {}), ...(q.search ? { email: { contains: q.search, mode: 'insensitive' as const } } : {}) };
  const [data, total] = await Promise.all([prisma.user.findMany({ where, skip, take: limit, select: userSelect, orderBy: { createdAt: 'desc' } }), prisma.user.count({ where })]);
  return { data: data.map(mapUser), total, page, limit };
});

app.post('/api/users', { preHandler: auth(['agency_admin']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const body = z.object({ email: z.string().email(), password: z.string().min(6), role: z.enum(['agency_admin', 'marketer', 'client']), client_id: z.string().uuid().nullable(), name: z.string().nullable() }).parse(request.body);
  if (body.role === 'client' && !body.client_id) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'client_id required for client role' });
  const created = await prisma.user.create({ data: { agencyId: user.agency_id, clientId: body.client_id, email: body.email, passwordHash: hashPassword(body.password), role: body.role, name: body.name }, select: userSelect });
  return reply.status(201).send(mapUser(created));
});

app.post('/api/users/:id/set-password', { preHandler: auth(['agency_admin']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ password: z.string().min(6) }).parse(request.body);
  await prisma.user.updateMany({ where: { id, agencyId: user.agency_id, deletedAt: null }, data: { passwordHash: hashPassword(body.password) } });
  return reply.status(204).send();
});

app.delete('/api/users/:id', { preHandler: auth(['agency_admin']) }, async (request, reply) => softDelete(request, reply, 'user'));

app.get('/api/clients', { preHandler: auth(['agency_admin', 'marketer']) }, async (request) => listClients(request));
app.post('/api/clients', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const body = z.object({ name: z.string().min(1) }).parse(request.body);
  return reply.status(201).send(await prisma.client.create({ data: { agencyId: user.agency_id, name: body.name } }));
});
app.get('/api/clients/:id', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => getOwnedClient(request, reply));
app.patch('/api/clients/:id', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ name: z.string().min(1) }).parse(request.body);
  const result = await prisma.client.updateMany({ where: { id, agencyId: user.agency_id, deletedAt: null }, data: body });
  if (!result.count) return notFound(reply, 'Client not found');
  return prisma.client.findUniqueOrThrow({ where: { id } });
});
app.delete('/api/clients/:id', { preHandler: auth(['agency_admin']) }, async (request, reply) => softDelete(request, reply, 'client'));

app.get('/api/campaigns', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request) => listCampaigns(request));
app.post('/api/campaigns', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const body = z.object({ client_id: z.string().uuid(), name: z.string().min(1), status: z.enum(['active', 'paused', 'archived']) }).parse(request.body);
  if (!(await ensureClient(user, body.client_id))) return notFound(reply, 'Client not found');
  return reply.status(201).send(await prisma.campaign.create({ data: { agencyId: user.agency_id, clientId: body.client_id, name: body.name, status: body.status, createdBy: user.id } }));
});
app.get('/api/campaigns/:id', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => getOwnedCampaign(request, reply));
app.patch('/api/campaigns/:id', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ name: z.string().min(1), status: z.enum(['active', 'paused', 'archived']) }).parse(request.body);
  const result = await prisma.campaign.updateMany({ where: { id, agencyId: user.agency_id, deletedAt: null }, data: body });
  if (!result.count) return notFound(reply, 'Campaign not found');
  const links = await prisma.link.findMany({ where: { campaignId: id }, select: { shortCode: true } });
  await Promise.all(links.map((link) => redis.del(`redirect:${link.shortCode}`).catch(() => null)));
  return prisma.campaign.findUniqueOrThrow({ where: { id } });
});
app.delete('/api/campaigns/:id', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const campaign = await prisma.campaign.findFirst({ where: { id, agencyId: user.agency_id, deletedAt: null } });
  if (!campaign) return notFound(reply, 'Campaign not found');
  const links = await prisma.link.findMany({ where: { campaignId: id, deletedAt: null }, select: { shortCode: true } });
  await prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
  await Promise.all(links.map((link) => redis.del(`redirect:${link.shortCode}`).catch(() => null)));
  return reply.status(204).send();
});

app.get('/api/links', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request) => listLinks(request));
app.post('/api/links', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const body = z.object({ client_id: z.string().uuid(), campaign_id: z.string().uuid(), original_url: z.string().url(), expires_at: z.string().datetime(), status: z.enum(['active', 'inactive']) }).parse(request.body);
  const expiresAt = new Date(body.expires_at);
  if (expiresAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'expires_at must be <= created_at + 365 days' });
  if (!(await ensureCampaign(user, body.campaign_id, body.client_id))) return notFound(reply, 'Campaign not found');
  const shortCode = await uniqueShortCode();
  const link = await prisma.link.create({ data: { agencyId: user.agency_id, clientId: body.client_id, campaignId: body.campaign_id, shortCode, originalUrl: body.original_url, expiresAt, status: body.status, createdBy: user.id } });
  return reply.status(201).send(mapLink(link, request));
});
app.get('/api/links/:id', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => getOwnedLink(request, reply));
app.patch('/api/links/:id', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ original_url: z.string().url(), expires_at: z.string().datetime(), status: z.enum(['active', 'inactive']) }).parse(request.body);
  const existing = await prisma.link.findFirst({ where: { id, agencyId: user.agency_id, deletedAt: null } });
  if (!existing) return notFound(reply, 'Link not found');
  const expiresAt = new Date(body.expires_at);
  if (expiresAt.getTime() > existing.createdAt.getTime() + 365 * 24 * 60 * 60 * 1000) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'expires_at must be <= created_at + 365 days' });
  const link = await prisma.link.update({ where: { id }, data: { originalUrl: body.original_url, expiresAt, status: body.status } });
  await redis.del(`redirect:${existing.shortCode}`).catch(() => null);
  return mapLink(link, request);
});
app.delete('/api/links/:id', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const link = await prisma.link.findFirst({ where: { id, agencyId: user.agency_id, deletedAt: null } });
  if (!link) return notFound(reply, 'Link not found');
  await prisma.link.update({ where: { id }, data: { deletedAt: new Date() } });
  await redis.del(`redirect:${link.shortCode}`).catch(() => null);
  return reply.status(204).send();
});

app.get('/api/links/:id/stats', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => {
  const link = await getAuthorizedLink(request, reply);
  if (!link) return;
  return stats({ linkId: link.id }, request.query);
});

app.get('/api/campaigns/:id/stats', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => {
  const campaign = await getAuthorizedCampaign(request, reply);
  if (!campaign) return;
  return stats({ campaignId: campaign.id }, request.query);
});

app.get('/api/dashboard', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request) => dashboard(request));

app.post('/api/reports', { preHandler: auth(['agency_admin', 'marketer']) }, async (request, reply) => {
  const user = (request as RequestWithUser).user!;
  const body = z.object({ client_id: z.string().uuid(), link_ids: z.array(z.string().uuid()).optional().default([]), date_from: z.string().datetime(), date_to: z.string().datetime() }).parse(request.body);
  if (!(await ensureClient(user, body.client_id))) return notFound(reply, 'Client not found');
  if (body.link_ids.length) {
    const count = await prisma.link.count({ where: { id: { in: body.link_ids }, agencyId: user.agency_id, clientId: body.client_id, deletedAt: null } });
    if (count !== body.link_ids.length) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'All link_ids must belong to the selected client' });
  }
  const report = await prisma.report.create({ data: { agencyId: user.agency_id, clientId: body.client_id, requestedBy: user.id, type: 'manual', status: 'pending', dateFrom: new Date(body.date_from), dateTo: new Date(body.date_to), linkIds: body.link_ids } });
  await publisher.publish<'report.requested', ReportRequestedPayload>('report.requested', { report_id: report.id, agency_id: user.agency_id, client_id: body.client_id, requested_by: user.id, type: 'manual', date_from: body.date_from, date_to: body.date_to, link_ids: body.link_ids });
  return reply.status(202).send({ report_id: report.id, status: 'pending' });
});

app.get('/api/reports', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request) => {
  const user = (request as RequestWithUser).user!;
  const { page, limit, skip } = pagination(request.query);
  const q = z.object({ client_id: z.string().optional(), status: z.string().optional(), type: z.string().optional() }).passthrough().parse(request.query);
  const where = { agencyId: user.agency_id, ...(user.role === 'client' ? { clientId: user.client_id! } : q.client_id ? { clientId: q.client_id } : {}), ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) };
  const [data, total] = await Promise.all([prisma.report.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }), prisma.report.count({ where })]);
  return { data: data.map(mapReport), total, page, limit };
});
app.get('/api/reports/:id', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => {
  const report = await getAuthorizedReport(request, reply);
  return report ? mapReport(report) : undefined;
});
app.get('/api/reports/:id/download', { preHandler: auth(['agency_admin', 'marketer', 'client']) }, async (request, reply) => {
  const report = await getAuthorizedReport(request, reply);
  if (!report || report.status !== 'done' || !report.filePath) return notFound(reply, 'Report not found');
  const file = await import('node:fs/promises').then((fs) => fs.readFile(report.filePath!)).catch(() => null);
  if (!file) return notFound(reply, 'Report not found');
  return reply.type('application/pdf').send(file);
});

app.get('/api/events/reports', async (request, reply) => {
  const q = z.object({ token: z.string().min(1) }).parse(request.query);
  const user = verifyJwt(q.token, jwtSecret);
  if (!user) return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  reply.raw.write(': connected\n\n');

  let closed = false;
  let lastPayload = '';
  const sendReports = async () => {
    if (closed) return;
    const reports = await prisma.report.findMany({
      where: { agencyId: user.agency_id, ...(user.role === 'client' ? { clientId: user.client_id! } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    const payload = JSON.stringify(reports.map(mapReport));
    if (payload !== lastPayload) {
      lastPayload = payload;
      reply.raw.write(`event: reports.updated\ndata: ${payload}\n\n`);
    } else {
      reply.raw.write(': keepalive\n\n');
    }
  };

  await sendReports().catch((error) => app.log.error(error));
  const interval = setInterval(() => sendReports().catch((error) => app.log.error(error)), 3000);
  request.raw.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
  return reply;
});

app.get('/:short_code', async (request, reply) => {
  const { short_code } = z.object({ short_code: z.string() }).parse(request.params);
  if (!isShortCode(short_code)) return redirect404(reply);
  const meta = await getRedirectMeta(short_code);
  if (!meta || meta.status !== 'active' || new Date(meta.expires_at).getTime() <= Date.now() || meta.campaign_status !== 'active') return redirect404(reply);
  const payload: ClickRecordedPayload = {
    agency_id: meta.agency_id, client_id: meta.client_id, campaign_id: meta.campaign_id, link_id: meta.link_id,
    short_code, clicked_at: new Date().toISOString(), ip_address: request.ip, user_agent: headerString(request.headers['user-agent']) ?? '', referrer: headerString(request.headers.referer ?? request.headers.referrer) ?? null
  };
  await publisher.publish('click.recorded', payload, 35);
  return reply.redirect(meta.original_url, 302);
});

async function getRedirectMeta(shortCode: string) {
  const key = `redirect:${shortCode}`;
  try {
    const cached = await redis.get(key);
    if (cached === '404') return null;
    if (cached) return JSON.parse(cached) as RedirectMeta;
  } catch {}
  const link = await prisma.link.findUnique({ where: { shortCode }, include: { campaign: true } });
  if (!link || link.deletedAt || link.status !== 'active' || link.expiresAt <= new Date() || link.campaign.deletedAt || link.campaign.status !== 'active') {
    await redis.set(key, '404', 'EX', 60).catch(() => null);
    return null;
  }
  const meta: RedirectMeta = { agency_id: link.agencyId, client_id: link.clientId, campaign_id: link.campaignId, campaign_status: link.campaign.status, link_id: link.id, original_url: link.originalUrl, status: link.status, expires_at: link.expiresAt.toISOString() };
  await redis.set(key, JSON.stringify(meta), 'EX', 3600).catch(() => null);
  return meta;
}

type RedirectMeta = { agency_id: string; client_id: string; campaign_id: string; campaign_status: string; link_id: string; original_url: string; status: string; expires_at: string };

function auth(roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? verifyJwt(token, jwtSecret) : null;
    if (!user) return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    if (!roles.includes(user.role)) return reply.status(403).send({ code: 'FORBIDDEN', message: 'Forbidden' });
    (request as RequestWithUser).user = user;
  };
}

function pagination(query: unknown) {
  const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20) }).passthrough().parse(query);
  return { page: q.page, limit: q.limit, skip: (q.page - 1) * q.limit };
}

async function listClients(request: FastifyRequest) {
  const user = (request as RequestWithUser).user!;
  const { page, limit, skip } = pagination(request.query);
  const q = z.object({ search: z.string().optional() }).passthrough().parse(request.query);
  const where = { agencyId: user.agency_id, deletedAt: null, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}) };
  const [data, total] = await Promise.all([prisma.client.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }), prisma.client.count({ where })]);
  return { data, total, page, limit };
}

async function listCampaigns(request: FastifyRequest) {
  const user = (request as RequestWithUser).user!;
  const { page, limit, skip } = pagination(request.query);
  const q = z.object({ client_id: z.string().optional(), status: z.string().optional(), search: z.string().optional() }).passthrough().parse(request.query);
  const where = { agencyId: user.agency_id, deletedAt: null, ...(user.role === 'client' ? { clientId: user.client_id! } : q.client_id ? { clientId: q.client_id } : {}), ...(q.status ? { status: q.status } : {}), ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}) };
  const [data, total] = await Promise.all([prisma.campaign.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }), prisma.campaign.count({ where })]);
  return { data, total, page, limit };
}

async function listLinks(request: FastifyRequest) {
  const user = (request as RequestWithUser).user!;
  const { page, limit, skip } = pagination(request.query);
  const q = z.object({ client_id: z.string().optional(), campaign_id: z.string().optional(), status: z.string().optional(), search: z.string().optional() }).passthrough().parse(request.query);
  const where = { agencyId: user.agency_id, deletedAt: null, ...(user.role === 'client' ? { clientId: user.client_id! } : q.client_id ? { clientId: q.client_id } : {}), ...(q.campaign_id ? { campaignId: q.campaign_id } : {}), ...(q.status ? { status: q.status } : {}), ...(q.search ? { shortCode: { contains: q.search } } : {}) };
  const [data, total] = await Promise.all([prisma.link.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }), prisma.link.count({ where })]);
  return { data: data.map((link) => mapLink(link, request)), total, page, limit };
}

async function getOwnedClient(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  if (user.role === 'client' && user.client_id !== id) return notFound(reply, 'Client not found');
  const client = await prisma.client.findFirst({ where: { id, agencyId: user.agency_id, deletedAt: null } });
  return client ?? notFound(reply, 'Client not found');
}

async function getOwnedCampaign(request: FastifyRequest, reply: FastifyReply) {
  const campaign = await getAuthorizedCampaign(request, reply);
  return campaign ?? undefined;
}

async function getOwnedLink(request: FastifyRequest, reply: FastifyReply) {
  const link = await getAuthorizedLink(request, reply);
  return link ? mapLink(link, request) : undefined;
}

async function getAuthorizedCampaign(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const campaign = await prisma.campaign.findFirst({ where: { id, agencyId: user.agency_id, deletedAt: null, ...(user.role === 'client' ? { clientId: user.client_id! } : {}) } });
  if (!campaign) { notFound(reply, 'Campaign not found'); return null; }
  return campaign;
}

async function getAuthorizedLink(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const link = await prisma.link.findFirst({ where: { id, agencyId: user.agency_id, deletedAt: null, ...(user.role === 'client' ? { clientId: user.client_id! } : {}) } });
  if (!link) { notFound(reply, 'Link not found'); return null; }
  return link;
}

async function getAuthorizedReport(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const report = await prisma.report.findFirst({ where: { id, agencyId: user.agency_id, ...(user.role === 'client' ? { clientId: user.client_id! } : {}) } });
  if (!report) { notFound(reply, 'Report not found'); return null; }
  return report;
}

async function softDelete(request: FastifyRequest, reply: FastifyReply, model: 'user' | 'client' | 'campaign') {
  const user = (request as RequestWithUser).user!;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  if (model === 'client') {
    const activeRelations = await prisma.client.findFirst({
      where: {
        id,
        agencyId: user.agency_id,
        deletedAt: null,
        OR: [{ campaigns: { some: { deletedAt: null, status: { in: ['active', 'paused'] } } } }, { links: { some: { deletedAt: null, status: 'active', expiresAt: { gt: new Date() } } } }]
      }
    });
    if (activeRelations) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Client has active campaigns or links' });
  }
  await (prisma[model] as any).updateMany({ where: { id, agencyId: user.agency_id, deletedAt: null }, data: { deletedAt: new Date() } });
  return reply.status(204).send();
}

async function ensureClient(user: JwtUser, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, agencyId: user.agency_id, deletedAt: null } });
  return Boolean(client);
}

async function ensureCampaign(user: JwtUser, campaignId: string, clientId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, clientId, agencyId: user.agency_id, deletedAt: null } });
  return Boolean(campaign);
}

async function uniqueShortCode() {
  for (let i = 0; i < 20; i++) {
    const shortCode = generateShortCode();
    if (!(await prisma.link.findUnique({ where: { shortCode } }))) return shortCode;
  }
  throw new Error('Could not generate short code');
}

async function stats(scope: { agencyId?: string; linkId?: string; campaignId?: string; clientId?: string }, query: unknown) {
  const q = z.object({ period: z.enum(['hour', 'day', 'week']).default('day'), date_from: z.string().datetime().optional(), date_to: z.string().datetime().optional() }).parse(query);
  const clickedAt = { ...(q.date_from ? { gte: new Date(q.date_from) } : {}), ...(q.date_to ? { lte: new Date(q.date_to) } : {}) };
  const where = { ...scope, ...(Object.keys(clickedAt).length ? { clickedAt } : {}) };
  const [totalClicks, uniqueRows, byCountry, byCity, byDevice, byBrowser, byOs, byReferrer, all] = await Promise.all([
    prisma.click.count({ where }),
    prisma.click.findMany({ where, distinct: ['linkId', 'ipHash', 'userAgentHash'], select: { id: true } }),
    group(where, ['country'], { country: { not: null } }),
    group(where, ['city', 'country'], { city: { not: null } }),
    group(where, ['deviceType'], { deviceType: { not: null } }),
    group(where, ['browser', 'browserVersion'], { browser: { not: null } }),
    group(where, ['os', 'osVersion'], { os: { not: null } }),
    group(where, ['referrerDomain'], { referrerDomain: { not: null } }),
    prisma.click.findMany({ where, select: { clickedAt: true }, orderBy: { clickedAt: 'asc' } })
  ]);
  return { total_clicks: totalClicks, unique_clicks: uniqueRows.length, clicks_over_time: bucket(all.map((r) => r.clickedAt), q.period), by_country: byCountry.map((r: any) => ({ country: r.country, count: r._count._all })), by_city: byCity.map((r: any) => ({ city: r.city, country: r.country, count: r._count._all })), by_device: byDevice.map((r: any) => ({ device_type: r.deviceType, count: r._count._all })), by_browser: byBrowser.map((r: any) => ({ browser: r.browser, browser_version: r.browserVersion, count: r._count._all })), by_os: byOs.map((r: any) => ({ os: r.os, os_version: r.osVersion, count: r._count._all })), by_referrer: byReferrer.map((r: any) => ({ referrer: r.referrerDomain, count: r._count._all })) };
}

async function dashboard(request: FastifyRequest) {
  const user = (request as RequestWithUser).user!;
  const q = z.object({ client_id: z.string().optional(), date_from: z.string().datetime().optional(), date_to: z.string().datetime().optional() }).parse(request.query);
  const clientId = user.role === 'client' ? user.client_id! : q.client_id;
  const linkWhere = { agencyId: user.agency_id, deletedAt: null, ...(clientId ? { clientId } : {}) };
  const clickScope = { ...(clientId ? { clientId } : { agencyId: user.agency_id }) };
  const s = await stats(clickScope, { period: 'day', date_from: q.date_from, date_to: q.date_to });
  const top = await prisma.click.groupBy({ by: ['linkId', 'shortCode'], where: clickScope, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 5 });
  return { total_links: await prisma.link.count({ where: linkWhere }), active_links: await prisma.link.count({ where: { ...linkWhere, status: 'active', expiresAt: { gt: new Date() } } }), total_clicks: s.total_clicks, unique_clicks: s.unique_clicks, top_links: top.map((r) => ({ link_id: r.linkId, short_code: r.shortCode, clicks: r._count._all })), clicks_over_time: s.clicks_over_time, by_country: s.by_country, by_device: s.by_device, by_browser: s.by_browser, by_os: s.by_os, by_referrer: s.by_referrer };
}

function group(where: any, by: string[], extra: any) {
  return prisma.click.groupBy({ by: by as any, where: { ...where, ...extra }, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 5 } as any);
}

function bucket(dates: Date[], period: 'hour' | 'day' | 'week') {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const d = new Date(date);
    if (period === 'hour') d.setUTCMinutes(0, 0, 0);
    if (period === 'day') d.setUTCHours(0, 0, 0, 0);
    if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)), d.setUTCHours(0, 0, 0, 0);
    counts.set(d.toISOString(), (counts.get(d.toISOString()) ?? 0) + 1);
  }
  return [...counts].map(([timestamp, count]) => ({ timestamp, count }));
}

const userSelect = { id: true, agencyId: true, clientId: true, email: true, role: true, name: true, isActive: true, createdAt: true };
function mapUser(user: any) { return { id: user.id, agency_id: user.agencyId, client_id: user.clientId, email: user.email, role: user.role, name: user.name, is_active: user.isActive, created_at: user.createdAt }; }
function mapLink(link: any, request?: FastifyRequest) { return { id: link.id, agency_id: link.agencyId, client_id: link.clientId, campaign_id: link.campaignId, short_code: link.shortCode, short_url: `${publicShortUrlBase(request)}/${link.shortCode}`, original_url: link.originalUrl, status: link.status, expires_at: link.expiresAt, last_clicked_at: link.lastClickedAt, created_by: link.createdBy, created_at: link.createdAt }; }
function mapReport(report: any) { return { id: report.id, agency_id: report.agencyId, client_id: report.clientId, type: report.type, status: report.status, download_url: report.status === 'done' ? `/api/reports/${report.id}/download` : null, error_message: report.errorMessage, date_from: report.dateFrom, date_to: report.dateTo, created_at: report.createdAt, completed_at: report.completedAt }; }
function emptyTemplate(overrides: Partial<NotificationSendPayload['template_data']> = {}) { return { report_id: null, link_id: null, short_code: null, client_name: null, campaign_name: null, requesting_user_email: null, download_url: null, ...overrides }; }
function notFound(reply: FastifyReply, message: string) { return reply.status(404).send({ code: 'NOT_FOUND', message }); }
function redirect404(reply: FastifyReply) { return reply.status(404).type('text/plain; charset=utf-8').send('Link not found'); }
function headerString(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

function setCorsHeaders(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin;
  reply.header('Access-Control-Allow-Origin', origin ?? '*');
  reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Max-Age', '86400');
  reply.header('Vary', 'Origin');
}

function publicShortUrlBase(request?: FastifyRequest) {
  if (shortUrlBase && !isLocalhostUrl(shortUrlBase)) return shortUrlBase.replace(/\/$/, '');
  const host = headerString(request?.headers['x-forwarded-host']) ?? request?.headers.host;
  if (!host) return (shortUrlBase ?? 'http://localhost:3000').replace(/\/$/, '');
  const proto = headerString(request?.headers['x-forwarded-proto']) ?? request?.protocol ?? 'https';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function isLocalhostUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '0.0.0.0' }).catch((error) => { app.log.error(error); process.exit(1); });
