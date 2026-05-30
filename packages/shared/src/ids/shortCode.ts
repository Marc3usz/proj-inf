const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateShortCode(random = Math.random): string {
  const char = () => alphabet[Math.floor(random() * alphabet.length)] ?? '0';
  return `${char()}${char()}${char()}-${char()}${char()}${char()}`;
}

export function isShortCode(value: string): boolean {
  return /^[0-9A-Za-z]{3}-[0-9A-Za-z]{3}$/.test(value);
}
