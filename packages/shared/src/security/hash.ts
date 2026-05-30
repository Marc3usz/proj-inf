import { createHash } from 'node:crypto';

export function saltedSha256(value: string | null | undefined, salt: string): string | null {
  if (!value) return null;
  return createHash('sha256').update(salt).update(':').update(value).digest('hex');
}
