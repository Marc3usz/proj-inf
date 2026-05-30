import { describe, expect, it } from 'vitest';
import { generateShortCode, isShortCode } from './shortCode.js';

describe('short codes', () => {
  it('generates XXX-XXX Base62 codes', () => {
    const code = generateShortCode(() => 0.5);

    expect(code).toMatch(/^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$/);
    expect(isShortCode('1X2-d4F')).toBe(true);
    expect(isShortCode('bad')).toBe(false);
  });
});
