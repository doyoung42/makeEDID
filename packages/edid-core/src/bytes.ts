/** Low-level byte/bit helpers shared by every block codec. */

export const BLOCK_SIZE = 128;
export const MAX_BLOCKS = 32; // 980mgr reads BLOCK0..BLOCK31

/** Extract bits [hi..lo] (inclusive, LSB=0) from a byte. */
export function bits(byte: number, hi: number, lo: number): number {
  return (byte >> lo) & ((1 << (hi - lo + 1)) - 1);
}

/** Build a byte from [hi,lo,value] triples. Values are masked to width. */
export function packBits(...fields: [hi: number, lo: number, value: number][]): number {
  let out = 0;
  for (const [hi, lo, value] of fields) {
    const width = hi - lo + 1;
    out |= (value & ((1 << width) - 1)) << lo;
  }
  return out & 0xff;
}

export function bit(byte: number, n: number): boolean {
  return ((byte >> n) & 1) === 1;
}

export function setBit(target: number, n: number, on: boolean): number {
  return on ? target | (1 << n) : target & ~(1 << n);
}

/** EDID checksum: all 128 bytes must sum to 0 mod 256. */
export function checksumFor(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE - 1; i++) sum += block[i]!;
  return (256 - (sum % 256)) % 256;
}

export function isChecksumValid(block: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += block[i]!;
  return sum % 256 === 0;
}

/** Parse contiguous uppercase/lowercase hex (no separators) into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error(`hex length ${clean.length} is odd`);
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("hex contains non-hex characters");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Format bytes as contiguous uppercase hex — matches Hex.toAscii() in 980mgr. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).toUpperCase().padStart(2, "0");
  return s;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Split a byte stream into 128-byte blocks. */
export function splitBlocks(data: Uint8Array): Uint8Array[] {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error(`EDID length ${data.length} is not a multiple of ${BLOCK_SIZE}`);
  }
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += BLOCK_SIZE) out.push(data.subarray(i, i + BLOCK_SIZE));
  return out;
}

export function concatBlocks(blocks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(blocks.length * BLOCK_SIZE);
  blocks.forEach((b, i) => out.set(b, i * BLOCK_SIZE));
  return out;
}
