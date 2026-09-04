import { BLOCK_SIZE, MAX_BLOCKS, bytesToHex } from "@edid/core";

/**
 * Reader/writer for `.ddc`, the format the EDID capture tooling actually emits
 * and the one this workbench saves.
 *
 * Reading is deliberately lenient and writing is strict:
 *
 * - **Read** accepts a raw binary capture (15 of the 1,397 corpus files are
 *   real binary, recognised by the EDID header magic) or any text carrying hex
 *   pairs, with whitespace, newlines and separators ignored. That is the same
 *   rule ATP Manager's own importer uses — it scans for `([0-9a-fA-F]{2})` and
 *   drops everything else (`EdidAsciiImporter.processLine`), so any file that
 *   tool could open opens here too.
 * - **Write** emits the canonical shape, measured across all 1,382 hex files in
 *   the corpus: uppercase, contiguous, one line, no trailing newline.
 */

/** EDID header, used to tell a raw binary capture from an ASCII-hex one. */
const EDID_MAGIC = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

export type DdcEncoding = "hex" | "binary";

export interface DdcFile {
  bytes: Uint8Array;
  /** How the source was stored, so a caller can report what it read. */
  encoding: DdcEncoding;
}

function looksBinary(data: Uint8Array): boolean {
  return data.length >= EDID_MAGIC.length && EDID_MAGIC.every((v, i) => data[i] === v);
}

/**
 * Parse a `.ddc` file, reporting how it was encoded.
 *
 * Accepts `Uint8Array` (file bytes) or `string` (already-decoded text), because
 * the browser reads a dropped file as text while the server reads bytes.
 */
export function readEdidDdc(data: Uint8Array | string): DdcFile {
  if (typeof data !== "string" && looksBinary(data)) {
    return { bytes: checkedLength(Uint8Array.from(data)), encoding: "binary" };
  }

  const text = typeof data === "string" ? data : latin1(data);
  const plain = scanHex(text);

  /*
   * A pasted hex dump usually carries an address gutter ("0010: 00 FF ..."),
   * and those addresses are themselves hex, so a naive scan swallows them and
   * shifts every byte. Retry without the gutter when the first attempt does not
   * produce something that looks like an EDID. All 1,397 corpus files start
   * with the header magic, so it is a reliable discriminator.
   */
  const bytes = isPlausibleEdid(plain) ? plain : pickBetter(plain, scanHex(stripGutter(text)));

  if (!looksBinary(bytes)) {
    throw new Error(
      "does not start with the EDID header (00 FF FF FF FF FF FF 00) — " +
      `read ${bytes.length} byte(s) beginning ${previewHex(bytes)}`,
    );
  }
  return { bytes: checkedLength(bytes), encoding: "hex" };
}

function scanHex(text: string): Uint8Array {
  const pairs = text.match(/[0-9a-fA-F]{2}/g);
  if (!pairs || pairs.length === 0) throw new Error("no hex bytes found");
  const bytes = new Uint8Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) bytes[i] = parseInt(pairs[i]!, 16);
  return bytes;
}

/** Drop a leading address column: hex digits followed by ':' or '|'. */
function stripGutter(text: string): string {
  return text.replace(/^[ \t]*[0-9a-fA-F]{1,8}[ \t]*[:|]/gm, "");
}

function isPlausibleEdid(bytes: Uint8Array): boolean {
  return looksBinary(bytes) && bytes.length % BLOCK_SIZE === 0;
}

/** Prefer whichever scan yields a real EDID; fall back to the first attempt. */
function pickBetter(plain: Uint8Array, deguttered: Uint8Array): Uint8Array {
  return isPlausibleEdid(deguttered) ? deguttered : plain;
}

function previewHex(bytes: Uint8Array): string {
  return bytesToHex(bytes.subarray(0, 8)).replace(/(..)(?=.)/g, "$1 ");
}

/** Parse a `.ddc` file to EDID bytes. */
export function parseEdidDdc(data: Uint8Array | string): Uint8Array {
  return readEdidDdc(data).bytes;
}

/** Canonical `.ddc` text: uppercase, contiguous, single line, no newline. */
export function serialiseEdidDdc(data: Uint8Array): string {
  return bytesToHex(checkedLength(data));
}

function checkedLength(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) throw new Error("file is empty");
  if (bytes.length % BLOCK_SIZE !== 0) {
    throw new Error(`${bytes.length} bytes is not a multiple of ${BLOCK_SIZE}`);
  }
  if (bytes.length / BLOCK_SIZE > MAX_BLOCKS) {
    throw new Error(`${bytes.length / BLOCK_SIZE} blocks exceeds the ${MAX_BLOCKS}-block maximum`);
  }
  return bytes;
}

/** Decode bytes as latin-1 so every byte maps to a character and none is lost. */
function latin1(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]!);
  return s;
}
