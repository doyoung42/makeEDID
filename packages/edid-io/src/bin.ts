import { BLOCK_SIZE, MAX_BLOCKS } from "@edid/core";

/** Raw .bin EDID: a whole number of 128-byte blocks, at most 32. */
export function parseEdidBin(data: Uint8Array): Uint8Array {
  if (data.length === 0) throw new Error("file is empty");
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error(`file is ${data.length} bytes; not a multiple of ${BLOCK_SIZE}`);
  }
  const blocks = Math.min(data.length / BLOCK_SIZE, MAX_BLOCKS);
  return Uint8Array.from(data.subarray(0, blocks * BLOCK_SIZE));
}

export function serialiseEdidBin(data: Uint8Array): Uint8Array {
  return Uint8Array.from(data);
}
