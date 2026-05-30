import { createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function passwordHash(password: string): string {
  const salt = randomUUID();
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function saltedSha256(value: string, salt: string): string {
  return createHash('sha256').update(salt).update(':').update(value).digest('hex');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}

async function main() {
  const agency = await prisma.agency.upsert({
    where: { slug: 'trackflow-beta-agency' },
    update: { name: 'TrackFlow Beta Agency', timezone: 'Europe/Warsaw' },
    create: { name: 'TrackFlow Beta Agency', slug: 'trackflow-beta-agency', timezone: 'Europe/Warsaw' }
  });

  const clients = await Promise.all(
    ['Acme Retail', 'Northwind Labs', 'Blue Ocean Travel'].map((name) =>
      prisma.client.upsert({
        where: { id: clientIds[name] },
        update: { name, agencyId: agency.id, deletedAt: null },
        create: { id: clientIds[name], name, agencyId: agency.id }
      })
    )
  );

  const [admin, marketer, clientUser] = await Promise.all([
    upsertUser(agency.id, null, 'admin@test.com', 'agency_admin', 'Agency Admin'),
    upsertUser(agency.id, null, 'marketer@test.com', 'marketer', 'Marketer'),
    upsertUser(agency.id, clients[0]!.id, 'client@test.com', 'client', 'Client User')
  ]);

  const campaigns = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      prisma.campaign.upsert({
        where: { id: campaignIds[index]! },
        update: { agencyId: agency.id, clientId: clients[index % clients.length]!.id, name: `Campaign ${index + 1}`, status: 'active', deletedAt: null },
        create: {
          id: campaignIds[index]!,
          agencyId: agency.id,
          clientId: clients[index % clients.length]!.id,
          name: `Campaign ${index + 1}`,
          status: 'active',
          createdBy: marketer.id
        }
      })
    )
  );

  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const shortCodes = ['1X2-d4F', 'Ab3-Zy9', 'Qwe-123', 'LmN-8kP', 'T7x-B2c'];
  const links = await Promise.all(
    shortCodes.map((shortCode, index) =>
      prisma.link.upsert({
        where: { shortCode },
        update: {
          agencyId: agency.id,
          clientId: campaigns[index]!.clientId,
          campaignId: campaigns[index]!.id,
          originalUrl: `https://example.com/landing-${index + 1}?utm_source=seed&utm_medium=email&utm_campaign=campaign-${index + 1}`,
          status: 'active',
          expiresAt,
          deletedAt: null
        },
        create: {
          agencyId: agency.id,
          clientId: campaigns[index]!.clientId,
          campaignId: campaigns[index]!.id,
          shortCode,
          originalUrl: `https://example.com/landing-${index + 1}?utm_source=seed&utm_medium=email&utm_campaign=campaign-${index + 1}`,
          status: 'active',
          createdBy: index === 0 ? admin.id : marketer.id,
          expiresAt
        }
      })
    )
  );

  const count = await prisma.click.count({ where: { agencyId: agency.id } });
  if (count < 100) {
    await prisma.click.createMany({
      skipDuplicates: true,
      data: Array.from({ length: 100 }, (_, index) => {
        const link = links[index % links.length]!;
        const clickedAt = new Date(Date.now() - (index % 7) * 24 * 60 * 60 * 1000 - index * 60 * 1000);
        return {
          eventId: randomUUID(),
          agencyId: agency.id,
          clientId: link.clientId,
          campaignId: link.campaignId,
          linkId: link.id,
          shortCode: link.shortCode,
          clickedAt,
          country: index % 3 === 0 ? 'PL' : index % 3 === 1 ? 'DE' : 'US',
          city: index % 3 === 0 ? 'Warsaw' : index % 3 === 1 ? 'Berlin' : 'New York',
          deviceType: index % 2 === 0 ? 'mobile' : 'desktop',
          browser: index % 2 === 0 ? 'Mobile Safari' : 'Chrome',
          os: index % 2 === 0 ? 'iOS' : 'Windows',
          referrer: 'https://instagram.com/example',
          referrerDomain: 'instagram.com',
          utmSource: 'seed',
          utmMedium: 'email',
          utmCampaign: `campaign-${(index % 5) + 1}`,
          ipHash: saltedSha256(`192.168.1.${index}`, 'seed-salt'),
          userAgentHash: saltedSha256(`seed-agent-${index % 10}`, 'seed-salt')
        };
      })
    });
  }

  await prisma.link.updateMany({ where: { id: { in: links.map((link) => link.id) } }, data: { lastClickedAt: new Date() } });
}

const clientIds: Record<string, string> = {
  'Acme Retail': '00000000-0000-4000-8000-000000000101',
  'Northwind Labs': '00000000-0000-4000-8000-000000000102',
  'Blue Ocean Travel': '00000000-0000-4000-8000-000000000103'
};

const campaignIds = [
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000204',
  '00000000-0000-4000-8000-000000000205'
];

async function upsertUser(agencyId: string, clientId: string | null, email: string, role: string, name: string) {
  return prisma.user.upsert({
    where: { agencyId_email: { agencyId, email } },
    update: { clientId, role, name, isActive: true, deletedAt: null },
    create: { agencyId, clientId, email, role, name, passwordHash: passwordHash('test123') }
  });
}

main().finally(async () => prisma.$disconnect());
