import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import amqp, { type Channel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { previousFullWeek, type ClickRecordedPayload, type EventEnvelope, type EventType, type NotificationSendPayload, type ReportRequestedPayload } from '@trackflow/shared';
import { hash, localDateKey, lookupGeo, parseReferrerAndUtm, parseUserAgent } from './parsers.js';

const prisma = new PrismaClient();
const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://trackflow:trackflow@localhost:5672';
const storagePath = process.env.PDF_STORAGE_PATH ?? '/app/storage/reports';
const salt = process.env.IP_HASH_SALT ?? 'change-me-in-prod';
const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

export async function processClick(envelope: EventEnvelope<'click.recorded', ClickRecordedPayload>) {
  const existing = await prisma.click.findUnique({ where: { eventId: envelope.event_id } });
  if (existing) return 'duplicate';
  const link = await prisma.link.findUnique({ where: { id: envelope.payload.link_id } });
  const ua = parseUserAgent(envelope.payload.user_agent);
  const geo = await lookupGeo(envelope.payload.ip_address, { url: process.env.GEOIP_API_URL ?? '', key: process.env.GEOIP_API_KEY, timeoutMs: Number(process.env.GEOIP_TIMEOUT_MS ?? 750) });
  const ref = parseReferrerAndUtm(envelope.payload.referrer, link?.originalUrl ?? null);
  const clickedAt = new Date(envelope.payload.clicked_at);
  await prisma.$transaction(async (tx) => {
    await tx.click.create({
      data: {
        eventId: envelope.event_id,
        agencyId: envelope.payload.agency_id,
        clientId: envelope.payload.client_id,
        campaignId: envelope.payload.campaign_id,
        linkId: envelope.payload.link_id,
        shortCode: envelope.payload.short_code,
        clickedAt,
        ...geo,
        ...ua,
        referrer: envelope.payload.referrer,
        ...ref,
        ipHash: hash(envelope.payload.ip_address, salt),
        userAgentHash: hash(envelope.payload.user_agent, salt)
      }
    });
    await tx.link.updateMany({ where: { id: envelope.payload.link_id, OR: [{ lastClickedAt: null }, { lastClickedAt: { lt: clickedAt } }] }, data: { lastClickedAt: clickedAt } });
  });
  return 'created';
}

export async function processReport(envelope: EventEnvelope<'report.requested', ReportRequestedPayload>, publish: PublishFn = publishEnvelope) {
  const report = await prisma.report.findUnique({ where: { id: envelope.payload.report_id }, include: { client: true } });
  if (!report || report.status === 'done') return;
  if (report.status === 'processing' && Date.now() - report.createdAt.getTime() < 30 * 60 * 1000) return;
  await prisma.report.update({ where: { id: report.id }, data: { status: 'processing', errorMessage: null } });
  try {
    const clicks = await prisma.click.findMany({ where: { clientId: report.clientId, clickedAt: { gte: report.dateFrom, lte: report.dateTo }, ...(report.linkIds.length ? { linkId: { in: report.linkIds } } : {}) }, orderBy: { clickedAt: 'asc' } });
    await mkdir(storagePath, { recursive: true });
    const filePath = `${storagePath}/report_${report.id}.pdf`;
    await writePdf(filePath, report.client.name, report.dateFrom, report.dateTo, clicks.length);
    await prisma.report.update({ where: { id: report.id }, data: { status: 'done', filePath, completedAt: new Date() } });
    const recipients = report.type === 'weekly'
      ? await prisma.user.findMany({ where: { agencyId: report.agencyId, clientId: report.clientId, role: 'client', deletedAt: null, isActive: true } })
      : report.requestedBy ? await prisma.user.findMany({ where: { id: report.requestedBy } }) : [];
    await Promise.all(recipients.map((user) => publish('notification.send', {
      type: report.type === 'weekly' ? 'weekly_report' : 'report_ready', agency_id: report.agencyId, client_id: report.clientId, recipient_email: user.email,
      subject: report.type === 'weekly' ? 'Weekly TrackFlow report' : 'TrackFlow report ready',
      template_data: template({ report_id: report.id, client_name: report.client.name, download_url: `${apiBase}/api/reports/${report.id}/download` })
    })));
  } catch (error) {
    await prisma.report.update({ where: { id: report.id }, data: { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() } });
  }
}

export async function processNotification(envelope: EventEnvelope<'notification.send', NotificationSendPayload>) {
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST ?? 'localhost', port: Number(process.env.SMTP_PORT ?? 1025), secure: false, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
  await transporter.sendMail({ from: process.env.SMTP_FROM ?? 'noreply@trackflow.io', to: envelope.payload.recipient_email, subject: envelope.payload.subject, text: renderText(envelope.payload), html: `<p>${renderText(envelope.payload)}</p>` });
}

export async function relayOutbox(limit = 100) {
  const events = await prisma.eventOutbox.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: limit });
  for (const event of events) {
    try {
      await publishEnvelopeRaw(event.payload as any);
      await prisma.eventOutbox.update({ where: { id: event.id }, data: { status: 'published', attempts: { increment: 1 }, lastError: null } });
    } catch (error) {
      await prisma.eventOutbox.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, status: event.attempts + 1 >= 10 ? 'failed' : 'pending', lastError: error instanceof Error ? error.message : String(error) } });
    }
  }
}

export async function runWeeklyReports(publish: PublishFn = publishEnvelope) {
  const now = new Date();
  if (now.getUTCDay() !== 1) return;
  const agencies = await prisma.agency.findMany({ where: { deletedAt: null }, include: { clients: { where: { deletedAt: null } } } });
  for (const agency of agencies) {
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: agency.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const localMinute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: agency.timezone, minute: '2-digit' }).format(now));
    if (localHour !== 8 || localMinute > 15) continue;
    const range = previousFullWeek(now, agency.timezone);
    for (const client of agency.clients) {
      const existing = await prisma.report.findFirst({ where: { agencyId: agency.id, clientId: client.id, type: 'weekly', dateFrom: range.date_from, dateTo: range.date_to } });
      const report = existing ?? await prisma.report.create({ data: { agencyId: agency.id, clientId: client.id, type: 'weekly', status: 'pending', dateFrom: range.date_from, dateTo: range.date_to, linkIds: [] } });
      await publish('report.requested', { report_id: report.id, agency_id: agency.id, client_id: client.id, requested_by: null, type: 'weekly', date_from: range.date_from.toISOString(), date_to: range.date_to.toISOString(), link_ids: [] });
    }
  }
}

export async function runNoClickAlerts(publish: PublishFn = publishEnvelope) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const links = await prisma.link.findMany({ where: { status: 'active', deletedAt: null, expiresAt: { gt: new Date() }, campaign: { status: 'active', deletedAt: null }, OR: [{ lastClickedAt: null, createdAt: { lt: cutoff } }, { lastClickedAt: { lt: cutoff } }] }, include: { agency: true, campaign: true, client: true, creator: true } });
  for (const link of links) {
    const recipients = await noClickRecipients(link.agencyId, link.creator.email);
    const sentForDate = new Date(`${localDateKey(new Date(), link.agency.timezone)}T00:00:00.000Z`);
    for (const email of recipients) {
      try {
        await prisma.alertDelivery.create({ data: { agencyId: link.agencyId, linkId: link.id, alertType: 'no_clicks_24h', sentForDate, recipientEmail: email } });
        await publish('notification.send', { type: 'alert_no_clicks', agency_id: link.agencyId, client_id: link.clientId, recipient_email: email, subject: `No clicks for ${link.shortCode}`, template_data: template({ link_id: link.id, short_code: link.shortCode, client_name: link.client.name, campaign_name: link.campaign.name }) });
      } catch {}
    }
  }
}

export async function noClickRecipients(agencyId: string, createdByEmail: string) {
  const marketers = await prisma.user.findMany({ where: { agencyId, role: 'marketer', deletedAt: null, isActive: true } });
  return [...new Set([createdByEmail, ...marketers.map((user) => user.email)])];
}

async function setupRabbit() {
  const connection = await amqp.connect(rabbitUrl);
  connection.on('error', (error) => console.error('RabbitMQ connection error', error));
  connection.on('close', () => setTimeout(() => startRabbitLoop(), 5000));
  const channel = await connection.createChannel();
  await channel.assertExchange('trackflow.events', 'topic', { durable: true });
  await channel.assertExchange('trackflow.dead', 'topic', { durable: true });
  await bindQueue(channel, 'trackflow.clicks', 'click.recorded');
  await bindQueue(channel, 'trackflow.reports', 'report.requested');
  await bindQueue(channel, 'trackflow.notifications', 'notification.send');
  await channel.consume('trackflow.clicks', (message) => handle(message, channel, (e) => processClick(e as any)));
  await channel.consume('trackflow.reports', (message) => handle(message, channel, (e) => processReport(e as any)));
  await channel.consume('trackflow.notifications', (message) => handle(message, channel, (e) => processNotification(e as any)));
}

function startRabbitLoop() {
  setupRabbit().catch((error) => {
    console.error('RabbitMQ setup failed', error);
    setTimeout(() => startRabbitLoop(), 5000);
  });
}

async function bindQueue(channel: Channel, queue: string, routingKey: string) {
  await channel.assertQueue(queue, { durable: true, deadLetterExchange: 'trackflow.dead', deadLetterRoutingKey: routingKey });
  await channel.bindQueue(queue, 'trackflow.events', routingKey);
  await channel.assertQueue(`trackflow.dead.${queue.split('.').pop()}`, { durable: true });
  await channel.bindQueue(`trackflow.dead.${queue.split('.').pop()}`, 'trackflow.dead', routingKey);
}

async function handle(message: ConsumeMessage | null, channel: Channel, fn: (envelope: EventEnvelope<EventType, any>) => Promise<unknown>) {
  if (!message) return;
  try {
    await fn(JSON.parse(message.content.toString()));
    channel.ack(message);
  } catch (error) {
    console.error(error);
    channel.nack(message, false, true);
  }
}

let confirmConnection: any = null;
let confirmChannel: ConfirmChannel | null = null;
type PublishFn = <T extends EventType>(eventType: T, payload: any) => Promise<void>;

async function publishEnvelope<T extends EventType>(eventType: T, payload: any) {
  await publishEnvelopeRaw({ event_id: crypto.randomUUID(), event_type: eventType, version: '1.0', timestamp: new Date().toISOString(), payload });
}

async function publishEnvelopeRaw(envelope: EventEnvelope<EventType, unknown>) {
  if (!confirmChannel) {
    confirmConnection = await amqp.connect(rabbitUrl) as any;
    confirmChannel = await confirmConnection.createConfirmChannel() as ConfirmChannel;
    await confirmChannel.assertExchange('trackflow.events', 'topic', { durable: true });
  }
  await new Promise<void>((resolve, reject) => confirmChannel!.publish('trackflow.events', envelope.event_type, Buffer.from(JSON.stringify(envelope)), { persistent: true, contentType: 'application/json' }, (error) => error ? reject(error) : resolve()));
}

function writePdf(filePath: string, clientName: string, from: Date, to: Date, clickCount: number) {
  return new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    doc.pipe(createWriteStream(filePath).on('finish', resolve).on('error', reject));
    doc.fontSize(20).text('TrackFlow Report');
    doc.moveDown().fontSize(12).text(`Client: ${clientName}`);
    doc.text(`Range: ${from.toISOString()} - ${to.toISOString()}`);
    doc.text(`Total clicks: ${clickCount}`);
    doc.end();
  });
}

function renderText(payload: NotificationSendPayload) {
  if (payload.type === 'alert_no_clicks') return `No clicks for link ${payload.template_data.short_code}.`;
  if (payload.type === 'password_reset_request') return `Password reset requested by ${payload.template_data.requesting_user_email}.`;
  return `Report is ready: ${payload.template_data.download_url ?? ''}`;
}

function template(overrides: Partial<NotificationSendPayload['template_data']>): NotificationSendPayload['template_data'] {
  return { report_id: null, link_id: null, short_code: null, client_name: null, campaign_name: null, requesting_user_email: null, download_url: null, ...overrides };
}

if (process.env.NODE_ENV !== 'test') {
  startRabbitLoop();
  setInterval(() => relayOutbox().catch(console.error), 1000);
  setInterval(() => runWeeklyReports().catch(console.error), 5 * 60 * 1000);
  setInterval(() => runNoClickAlerts().catch(console.error), 15 * 60 * 1000);
}
