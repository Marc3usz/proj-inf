import { randomUUID } from 'node:crypto';
import amqp, { type ConfirmChannel } from 'amqplib';
import type { PrismaClient } from '@prisma/client';
import type { EventEnvelope, EventType } from '@trackflow/shared';

export class EventPublisher {
  private connection: any = null;
  private channel: ConfirmChannel | null = null;

  constructor(private readonly url: string, private readonly prisma: PrismaClient) {}

  async publish<T extends EventType, P>(event_type: T, payload: P, timeoutMs = 35): Promise<EventEnvelope<T, P>> {
    const envelope: EventEnvelope<T, P> = { event_id: randomUUID(), event_type, version: '1.0', timestamp: new Date().toISOString(), payload };
    try {
      await withTimeout(this.publishEnvelope(envelope), timeoutMs);
    } catch (error) {
      await this.prisma.eventOutbox.create({ data: { eventId: envelope.event_id, eventType: event_type, payload: envelope as any, status: 'pending', lastError: error instanceof Error ? error.message : String(error) } });
    }
    return envelope;
  }

  async publishEnvelope(envelope: EventEnvelope<EventType, unknown>): Promise<void> {
    const channel = await this.getChannel();
    const routingKey = envelope.event_type;
    await new Promise<void>((resolve, reject) => {
      channel.publish('trackflow.events', routingKey, Buffer.from(JSON.stringify(envelope)), { persistent: true, contentType: 'application/json' }, (error) => (error ? reject(error) : resolve()));
    });
  }

  private async getChannel() {
    if (this.channel) return this.channel;
    this.connection = await amqp.connect(this.url) as any;
    this.channel = await this.connection.createConfirmChannel() as ConfirmChannel;
    await this.channel.assertExchange('trackflow.events', 'topic', { durable: true });
    return this.channel;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('publish timeout')), ms);
    promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}
