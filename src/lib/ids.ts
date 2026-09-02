const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `${prefix}_${suffix}`;
}
