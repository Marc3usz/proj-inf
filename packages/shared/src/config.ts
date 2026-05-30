import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  IP_HASH_SALT: z.string().min(8),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().email(),
  PDF_STORAGE_PATH: z.string().min(1),
  GEOIP_PROVIDER: z.string().min(1),
  GEOIP_API_URL: z.string().url(),
  GEOIP_API_KEY: z.string().optional().default(''),
  GEOIP_TIMEOUT_MS: z.coerce.number().int().positive().default(750),
  APP_BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  PUBLIC_SHORT_URL_BASE: z.string().url().optional(),
  PUBLIC_API_BASE_URL: z.string().url().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(input);
}
