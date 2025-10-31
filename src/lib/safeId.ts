// Generates a UUID v4 with proper variant/version bits.
// Uses crypto.getRandomValues when available, falls back to Math.random.
export function safeUUID(): string {
  const cryptoObj: Crypto | undefined = (globalThis as any).crypto;
  let bytes = new Uint8Array(16);

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    bytes = cryptoObj.getRandomValues(new Uint8Array(16));
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC 4122 variant & version
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  const b = Array.from(bytes).map(toHex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}
