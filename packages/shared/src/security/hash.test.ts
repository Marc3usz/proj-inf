import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { saltedSha256 } from './hash.js';

describe('saltedSha256', () => {
  it('returns a deterministic salted SHA-256 hash for non-empty values', () => {
    const expected = createHash('sha256').update('salt').update(':').update('value').digest('hex');

    expect(saltedSha256('value', 'salt')).toBe(expected);
  });

  it('returns null for missing or empty values', () => {
    expect(saltedSha256(null, 'salt')).toBeNull();
    expect(saltedSha256(undefined, 'salt')).toBeNull();
    expect(saltedSha256('', 'salt')).toBeNull();
  });
});
