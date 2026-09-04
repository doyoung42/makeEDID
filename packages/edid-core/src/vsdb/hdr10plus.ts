import { bits } from "../bytes.js";

/**
 * HDR10+ Vendor-Specific Video Data Block, OUI 90-84-8B.
 *
 * The payload after the OUI is a single byte. Its layout was derived from 297
 * corpus EDIDs cross-checked against their decoded reports — every observed
 * value is explained by:
 *
 *   bits[1:0] Application_Version
 *   bits[3:2] Full_Frame_Peak_Luminance_Index
 *   bits[7:4] Peak_Luminance_Index
 *
 * (The reference Python decoder read these from the OUI bytes instead, and
 * dispatched on extended tag 0x01 without checking the OUI at all.)
 */
export const HDR10PLUS_OUI = 0x90848b;

export interface Hdr10PlusVsvdb {
  applicationVersion: number;
  fullFramePeakLuminanceIndex: number;
  peakLuminanceIndex: number;
  /** Anything past the first byte, preserved verbatim. */
  trailing: Uint8Array;
}

export function parseHdr10PlusVsvdb(p: Uint8Array): Hdr10PlusVsvdb {
  if (p.length < 1) throw new Error("HDR10+ payload is empty");
  const b = p[0]!;
  return {
    applicationVersion: bits(b, 1, 0),
    fullFramePeakLuminanceIndex: bits(b, 3, 2),
    peakLuminanceIndex: bits(b, 7, 4),
    trailing: Uint8Array.from(p.subarray(1)),
  };
}

export function buildHdr10PlusVsvdb(v: Hdr10PlusVsvdb): Uint8Array {
  const b =
    ((v.peakLuminanceIndex & 0x0f) << 4) |
    ((v.fullFramePeakLuminanceIndex & 0x03) << 2) |
    (v.applicationVersion & 0x03);
  return Uint8Array.from([b, ...v.trailing]);
}
