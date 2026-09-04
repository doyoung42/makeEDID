import { bits, bit } from "./bytes.js";
import type { Descriptor, DetailedTimingDescriptor, RangeLimitsDescriptor } from "./types.js";

export const DESCRIPTOR_SIZE = 18;

/** Decode one 18-byte descriptor slot. */
export function decodeDescriptor(d: Uint8Array): Descriptor {
  // A descriptor is a DTD when the first two bytes (pixel clock) are non-zero.
  if (d[0] !== 0 || d[1] !== 0) return decodeDetailedTiming(d);

  const tag = d[3]!;
  const field = () => decodeTextField(d.subarray(5, 18));
  switch (tag) {
    case 0xfc: return { kind: "product-name", ...field() };
    case 0xff: return { kind: "serial-number", ...field() };
    case 0xfe: return { kind: "text", ...field() };
    case 0xfd: return decodeRangeLimits(d);
    default:   return { kind: "unknown", tag, raw: Uint8Array.from(d) };
  }
}

export function encodeDescriptor(desc: Descriptor): Uint8Array {
  switch (desc.kind) {
    case "detailed-timing": return encodeDetailedTiming(desc);
    case "product-name":    return encodeTextDescriptor(0xfc, desc.text, desc.padByte);
    case "serial-number":   return encodeTextDescriptor(0xff, desc.text, desc.padByte);
    case "text":            return encodeTextDescriptor(0xfe, desc.text, desc.padByte);
    case "range-limits":    return encodeRangeLimits(desc);
    case "unknown":         return Uint8Array.from(desc.raw);
  }
}

// ------------------------------------------------------------ detailed timing

export function decodeDetailedTiming(d: Uint8Array): DetailedTimingDescriptor {
  const pixelClock = (d[1]! << 8) | d[0]!;               // 10 kHz units
  const hActive = ((bits(d[4]!, 7, 4)) << 8) | d[2]!;
  const hBlank  = ((bits(d[4]!, 3, 0)) << 8) | d[3]!;
  const vActive = ((bits(d[7]!, 7, 4)) << 8) | d[5]!;
  const vBlank  = ((bits(d[7]!, 3, 0)) << 8) | d[6]!;

  const hSyncOffset = (bits(d[11]!, 7, 6) << 8) | d[8]!;
  const hSyncPulse  = (bits(d[11]!, 5, 4) << 8) | d[9]!;
  const vSyncOffset = (bits(d[11]!, 3, 2) << 4) | bits(d[10]!, 7, 4);
  const vSyncPulse  = (bits(d[11]!, 1, 0) << 4) | bits(d[10]!, 3, 0);

  const hSizeMm = (bits(d[14]!, 7, 4) << 8) | d[12]!;
  const vSizeMm = (bits(d[14]!, 3, 0) << 8) | d[13]!;

  const flags = d[17]!;
  return {
    kind: "detailed-timing",
    pixelClockKhz: pixelClock * 10,
    hActive, hBlank, vActive, vBlank,
    hSyncOffset, hSyncPulse, vSyncOffset, vSyncPulse,
    hSizeMm, vSizeMm,
    hBorder: d[15]!, vBorder: d[16]!,
    interlaced: bit(flags, 7),
    stereo: (bits(flags, 6, 5) << 1) | (flags & 1),
    syncType: bits(flags, 4, 3),
    syncFlags: bits(flags, 2, 1),
  };
}

export function encodeDetailedTiming(t: DetailedTimingDescriptor): Uint8Array {
  const d = new Uint8Array(DESCRIPTOR_SIZE);
  const pixelClock = Math.round(t.pixelClockKhz / 10);
  d[0] = pixelClock & 0xff;
  d[1] = (pixelClock >> 8) & 0xff;
  d[2] = t.hActive & 0xff;
  d[3] = t.hBlank & 0xff;
  d[4] = (((t.hActive >> 8) & 0x0f) << 4) | ((t.hBlank >> 8) & 0x0f);
  d[5] = t.vActive & 0xff;
  d[6] = t.vBlank & 0xff;
  d[7] = (((t.vActive >> 8) & 0x0f) << 4) | ((t.vBlank >> 8) & 0x0f);
  d[8] = t.hSyncOffset & 0xff;
  d[9] = t.hSyncPulse & 0xff;
  d[10] = ((t.vSyncOffset & 0x0f) << 4) | (t.vSyncPulse & 0x0f);
  d[11] =
    (((t.hSyncOffset >> 8) & 0x03) << 6) |
    (((t.hSyncPulse >> 8) & 0x03) << 4) |
    (((t.vSyncOffset >> 4) & 0x03) << 2) |
    ((t.vSyncPulse >> 4) & 0x03);
  d[12] = t.hSizeMm & 0xff;
  d[13] = t.vSizeMm & 0xff;
  d[14] = (((t.hSizeMm >> 8) & 0x0f) << 4) | ((t.vSizeMm >> 8) & 0x0f);
  d[15] = t.hBorder & 0xff;
  d[16] = t.vBorder & 0xff;
  d[17] =
    (t.interlaced ? 0x80 : 0) |
    (((t.stereo >> 1) & 0x03) << 5) |
    ((t.syncType & 0x03) << 3) |
    ((t.syncFlags & 0x03) << 1) |
    (t.stereo & 1);
  return d;
}

// -------------------------------------------------------------- range limits

function decodeRangeLimits(d: Uint8Array): RangeLimitsDescriptor {
  const offsets = d[4]!;
  // Offset bits add 255 to the corresponding min/max value.
  const vMinOffset = bit(offsets, 0) ? 255 : 0;
  const vMaxOffset = bit(offsets, 1) ? 255 : 0;
  const hMinOffset = bit(offsets, 2) ? 255 : 0;
  const hMaxOffset = bit(offsets, 3) ? 255 : 0;
  return {
    kind: "range-limits",
    minVerticalHz: d[5]! + vMinOffset,
    maxVerticalHz: d[6]! + vMaxOffset,
    minHorizontalKhz: d[7]! + hMinOffset,
    maxHorizontalKhz: d[8]! + hMaxOffset,
    maxPixelClockMhz: d[9]! * 10,
    offsetFlags: offsets,
    timingSupport: d[10]!,
    extra: Uint8Array.from(d.subarray(11, 18)),
  };
}

function encodeRangeLimits(r: RangeLimitsDescriptor): Uint8Array {
  const d = new Uint8Array(DESCRIPTOR_SIZE);
  d[3] = 0xfd;
  d[4] = r.offsetFlags;
  const vMinOffset = bit(r.offsetFlags, 0) ? 255 : 0;
  const vMaxOffset = bit(r.offsetFlags, 1) ? 255 : 0;
  const hMinOffset = bit(r.offsetFlags, 2) ? 255 : 0;
  const hMaxOffset = bit(r.offsetFlags, 3) ? 255 : 0;
  d[5] = (r.minVerticalHz - vMinOffset) & 0xff;
  d[6] = (r.maxVerticalHz - vMaxOffset) & 0xff;
  d[7] = (r.minHorizontalKhz - hMinOffset) & 0xff;
  d[8] = (r.maxHorizontalKhz - hMaxOffset) & 0xff;
  d[9] = Math.round(r.maxPixelClockMhz / 10) & 0xff;
  d[10] = r.timingSupport;
  d.set(r.extra.subarray(0, 7), 11);
  return d;
}

// ---------------------------------------------------------------- text descr

/**
 * EDID text is 13 bytes, terminated by 0x0A when shorter, then padded. The pad
 * byte is captured rather than assumed: the spec says 0x20 but shipping panels
 * use 0x00, and guessing wrong rewrites bytes on an otherwise untouched save.
 */
function decodeTextField(raw: Uint8Array): { text: string; padByte: number } {
  let end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0a) { end = i; break; }
  }
  let s = "";
  for (let i = 0; i < end; i++) s += String.fromCharCode(raw[i]!);
  // The byte after the terminator is the padding filler (absent when text fills the field).
  const padByte = end + 1 < raw.length ? raw[end + 1]! : 0x20;
  return { text: s.replace(/\s+$/, ""), padByte };
}

function encodeTextDescriptor(tag: number, text: string, padByte: number): Uint8Array {
  const d = new Uint8Array(DESCRIPTOR_SIZE);
  d[3] = tag;
  const body = new Uint8Array(13).fill(padByte & 0xff);
  const chars = text.slice(0, 13);
  for (let i = 0; i < chars.length; i++) body[i] = chars.charCodeAt(i) & 0xff;
  if (chars.length < 13) body[chars.length] = 0x0a;
  d.set(body, 5);
  return d;
}
