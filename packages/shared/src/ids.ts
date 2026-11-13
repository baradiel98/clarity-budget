/** Random identifiers. Callers on each platform inject a secure random source. */
export type RandomBytes = (n: number) => Uint8Array;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function makeIdFactory(randomBytes: RandomBytes) {
  return (prefix: string): string => {
    const bytes = randomBytes(16);
    let out = '';
    for (const b of bytes) out += ALPHABET[b % 36];
    return `${prefix}_${out}`;
  };
}
