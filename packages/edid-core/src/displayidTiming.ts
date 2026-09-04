import { bit, bits } from "./bytes.js";

/**
 * DisplayID Type I detailed timing (tag 0x03), 20 bytes.
 *
 * Layout from com.quantumdata.i980.core.edid.model.dispid.timing.TypeI —
 * `readBuffer`/`writeBuffer` for byte order, the accessor pairs for how each
 * stored value maps to the value shown to a user (mostly "stored = actual - 1",
 * so a 0 in the file means 1). This is the block the corpus actually carries:
 * 365 instances, versus zero for the DisplayID 2.0 blocks already modelled.
 */

export const TYPE_I_TIMING_LENGTH = 20;

export const ASPECT_RATIO_LABEL = [
  "1:1", "5:4", "4:3", "15:9", "16:9", "16:10", "64:27", "256:135", "Not Defined",
];

export const SUPPORT_3D_LABEL = ["Monoscopic", "Stereo", "Monoscopic or Stereo", "Reserved"];

export interface TypeITiming {
  pixelClockMhz: number;
  aspectRatio: number;      // 0-8, see ASPECT_RATIO_LABEL
  interlaced: boolean;
  preferred: boolean;
  support3d: number;        // 0-3, see SUPPORT_3D_LABEL
  hActive: number; hBlank: number;
  hSyncOffset: number; hSyncWidth: number; hSyncPositive: boolean;
  vActive: number; vBlank: number;
  vSyncOffset: number; vSyncWidth: number; vSyncPositive: boolean;
  /** Bytes past the 20 modelled, for blocks whose length exceeds MIN_LENGTH. */
  trailing: Uint8Array;
}

export function parseTypeITiming(p: Uint8Array): TypeITiming {
  return parseDetailed20(p, 100, 0);
}

/**
 * The 20-byte detailed timing shared by Type I and Type VII.
 *
 * `clockDivisor` is the pixel-clock multiplier from the model constructor:
 * 100 for Type I (value is 0.01 MHz units), 1000 for Type VII.
 */
function parseDetailed20(p: Uint8Array, clockDivisor: number, extraLength: number): TypeITiming {
  const needed = TYPE_I_TIMING_LENGTH + extraLength;
  if (p.length < needed) {
    throw new Error(`Detailed timing is ${p.length} bytes; ${needed} required`);
  }
  const u16 = (at: number) => p[at]! | (p[at + 1]! << 8);
  const options = p[3]!;
  const hSync = u16(8);
  const vSync = u16(16);

  return {
    pixelClockMhz: ((p[0]! | (p[1]! << 8) | (p[2]! << 16)) + 1) / clockDivisor,
    aspectRatio: bits(options, 3, 0),
    interlaced: bit(options, 4),
    support3d: bits(options, 6, 5),
    preferred: bit(options, 7),
    hActive: u16(4) + 1,
    hBlank: u16(6) + 1,
    hSyncOffset: (hSync & 0x7fff) + 1,
    hSyncPositive: bit(hSync, 15),
    hSyncWidth: u16(10) + 1,
    vActive: u16(12) + 1,
    vBlank: u16(14) + 1,
    vSyncOffset: (vSync & 0x7fff) + 1,
    vSyncPositive: bit(vSync, 15),
    vSyncWidth: u16(18) + 1,
    trailing: Uint8Array.from(p.subarray(TYPE_I_TIMING_LENGTH)),
  };
}

export function buildTypeITiming(t: TypeITiming): Uint8Array {
  return buildDetailed20(t, 100);
}

function buildDetailed20(t: TypeITiming, clockDivisor: number): Uint8Array {
  const out = new Uint8Array(TYPE_I_TIMING_LENGTH + t.trailing.length);
  const push16 = (at: number, v: number) => { out[at] = v & 0xff; out[at + 1] = (v >> 8) & 0xff; };

  const clock = Math.round(t.pixelClockMhz * clockDivisor) - 1;
  out[0] = clock & 0xff; out[1] = (clock >> 8) & 0xff; out[2] = (clock >> 16) & 0xff;
  out[3] = (t.aspectRatio & 0x0f)
    | (t.interlaced ? 0x10 : 0)
    | ((t.support3d & 0x03) << 5)
    | (t.preferred ? 0x80 : 0);

  push16(4, t.hActive - 1);
  push16(6, t.hBlank - 1);
  push16(8, ((t.hSyncOffset - 1) & 0x7fff) | (t.hSyncPositive ? 0x8000 : 0));
  push16(10, t.hSyncWidth - 1);
  push16(12, t.vActive - 1);
  push16(14, t.vBlank - 1);
  push16(16, ((t.vSyncOffset - 1) & 0x7fff) | (t.vSyncPositive ? 0x8000 : 0));
  push16(18, t.vSyncWidth - 1);

  out.set(t.trailing, TYPE_I_TIMING_LENGTH);
  return out;
}

// ------------------------------------------------------------- Type VII

/**
 * DisplayID Type VII detailed timing, 20 bytes plus optional trailing bytes.
 *
 * `TypeVII extends TypeI` in the decompiled ATP Manager: identical byte layout,
 * two differences only —
 *   - the pixel clock multiplier is 1000, not 100, so the field is MHz/1000
 *     (`TypeVII()` passes 1000.0 to the TypeI constructor);
 *   - bit 7 of the options byte is read as "supports YCbCr 4:2:0" rather than
 *     "preferred" (`TypeVII.supportsY420()` returns `isPreferred()`).
 *
 * The trailing byte count is not stored per descriptor — it comes from the
 * enclosing block's `T7_M` field and is passed in here.
 *
 * ⚠ The options byte has a documented ambiguity. This follows the decompiled
 * implementation (bits 3:0 aspect, bit 4 interlaced, bits 6:5 3D, bit 7 Y420);
 * the CTA-861-H field extraction instead reads bits 4:0 as aspect, bit 5 as
 * interlaced and bit 6 as 3D. Every Type VII block in the corpus has bits 7:4
 * clear, so the two readings agree on all real data and neither can be
 * falsified from it. The decompiled tool is the stronger evidence tier here.
 */
export interface TypeVIITiming extends Omit<TypeITiming, "preferred"> {
  /** Options bit 7. Named "preferred" in Type I, Y420 support in Type VII. */
  supportsY420: boolean;
}

export function parseTypeVIITiming(p: Uint8Array, extraLength = 0): TypeVIITiming {
  const base = parseDetailed20(p, 1000, extraLength);
  const { preferred, ...rest } = base;
  return { ...rest, supportsY420: preferred };
}

export function buildTypeVIITiming(t: TypeVIITiming): Uint8Array {
  const { supportsY420, ...rest } = t;
  return buildDetailed20({ ...rest, preferred: supportsY420 }, 1000);
}

// --------------------------------------------------------------- Type X

/** Formula/algorithm codes in the Type X descriptor's flags byte, bits 2:0. */
export const TIMING_FORMULA_LABEL = [
  "Standard CVT 1.2", "Reduced Blanking CVT 1.2", "Reduced Blanking CVT 2.0",
  "Reserved 3", "Reserved 4", "Reserved 5", "Reserved 6", "Reserved 7",
];

export const TYPE_X_BASE_LENGTH = 6;

/**
 * DisplayID Type X formula-based timing — 6 bytes, optionally extended.
 *
 * Layout from com.quantumdata.i980.core.edid.model.dispid.timing.TypeX and
 * verified against all 48 Type X blocks in the corpus, which decode to real
 * modes (3840x2160@240, 3840x1600@120, 2560x1440@240) with zero remainder.
 *
 * The 7th byte, when present, widens the refresh rate from 8 to 10 bits and
 * carries the blanking deltas — which is why the tool it replaces swaps its
 * units label between "Hz (1 - 256)" and "Hz (1 - 1024)".
 */
export interface TypeXTiming {
  /** Bits 2:0 of the flags byte — see TIMING_FORMULA_LABEL. */
  algorithm: number;
  supportsY420: boolean;
  support3d: number;
  hActive: number;
  vActive: number;
  refreshHz: number;
  /** Present only when the descriptor carries at least one extra byte. */
  deltaHBlank: number | null;
  deltaVBlank: number | null;
  /** Byte 8 bit 0, present only with two or more extra bytes. */
  altMinVblank: boolean | null;
  /** Extra bytes past the ones modelled above, preserved verbatim. */
  trailing: Uint8Array;
}

export function parseTypeXTiming(p: Uint8Array, extraLength = 0): TypeXTiming {
  const total = TYPE_X_BASE_LENGTH + extraLength;
  if (p.length < total) {
    throw new Error(`Type X timing is ${p.length} bytes; ${total} required`);
  }
  const flags = p[0]!;
  const hasByte7 = extraLength >= 1;
  const byte7 = hasByte7 ? p[6]! : 0;

  return {
    algorithm: bits(flags, 2, 0),
    support3d: bits(flags, 6, 5),
    supportsY420: bit(flags, 7),
    hActive: (p[1]! | (p[2]! << 8)) + 1,
    vActive: (p[3]! | (p[4]! << 8)) + 1,
    // The extra byte supplies two more significant bits of the refresh rate.
    refreshHz: (p[5]! | (hasByte7 ? bits(byte7, 1, 0) << 8 : 0)) + 1,
    deltaHBlank: hasByte7 ? bits(byte7, 4, 2) : null,
    deltaVBlank: hasByte7 ? bits(byte7, 7, 5) : null,
    altMinVblank: extraLength >= 2 ? bit(p[7]!, 0) : null,
    trailing: Uint8Array.from(p.subarray(Math.min(total, TYPE_X_BASE_LENGTH + 2))),
  };
}

export function buildTypeXTiming(t: TypeXTiming, extraLength = 0): Uint8Array {
  const out = new Uint8Array(TYPE_X_BASE_LENGTH + extraLength);
  out[0] = (t.algorithm & 0x07) | ((t.support3d & 0x03) << 5) | (t.supportsY420 ? 0x80 : 0);

  const h = t.hActive - 1;
  out[1] = h & 0xff;
  out[2] = (h >> 8) & 0xff;
  const v = t.vActive - 1;
  out[3] = v & 0xff;
  out[4] = (v >> 8) & 0xff;

  const rate = t.refreshHz - 1;
  out[5] = rate & 0xff;
  if (extraLength >= 1) {
    out[6] = ((rate >> 8) & 0x03)
      | (((t.deltaHBlank ?? 0) & 0x07) << 2)
      | (((t.deltaVBlank ?? 0) & 0x07) << 5);
  }
  if (extraLength >= 2) out[7] = t.altMinVblank ? 1 : 0;
  if (extraLength > 2) out.set(t.trailing.subarray(0, extraLength - 2), TYPE_X_BASE_LENGTH + 2);
  return out;
}

/** Horizontal blanking delta in pixels. `TypeX.deltaHBlankPixels()`. */
export function deltaHBlankPixels(code: number, algorithmFlag: boolean): number {
  if (algorithmFlag && code > 5) return (5 - code) * 8;
  return code * 8;
}

/** Vertical blanking delta in microseconds. `TypeX.deltaVBlankUS()`. */
export function deltaVBlankMicros(code: number, altMinVblank: boolean): number {
  return code * (altMinVblank ? 20 : 35);
}

// ------------------------------------------------- Type VIII enumerated codes

/** `TimingCodeType` — what standard the enumerated codes are drawn from. */
export const TIMING_CODE_TYPE_LABEL = ["DMT", "CTA", "HDMI", "Reserved"] as const;

export interface TypeVIIIOptions {
  blockRevision: number;
  /** 1 or 2 bytes per code. */
  codeSize: number;
  supportsY420: boolean;
  codeType: number;
}

/**
 * Type VIII option bits, which sit at **different positions in each carrier**.
 *
 * This is a sharper version of the Type VII/X carrier split: there the options
 * byte only moved, here the bits move inside it as well.
 *
 * | field | CTA (`CtaTypeVIIITimingBlock`) | DisplayID (`TypeVIIIBlock`) |
 * |---|---|---|
 * | block revision | bits 2:0 | (the revision byte itself) |
 * | code size      | bit 3    | bit 0 |
 * | Y'CbCr 4:2:0   | bit 5    | bit 2 |
 * | code type      | bits 7:6 | bits 4:3 |
 */
export function parseTypeVIIIOptions(optionsByte: number, carrier: "cta" | "displayid"): TypeVIIIOptions {
  if (carrier === "cta") {
    return {
      blockRevision: bits(optionsByte, 2, 0),
      codeSize: bit(optionsByte, 3) ? 2 : 1,
      supportsY420: bit(optionsByte, 5),
      codeType: bits(optionsByte, 7, 6),
    };
  }
  return {
    blockRevision: bits(optionsByte, 7, 5),
    codeSize: bit(optionsByte, 0) ? 2 : 1,
    supportsY420: bit(optionsByte, 2),
    codeType: bits(optionsByte, 4, 3),
  };
}

export function buildTypeVIIIOptions(o: TypeVIIIOptions, carrier: "cta" | "displayid"): number {
  if (carrier === "cta") {
    return ((o.blockRevision & 0x07)
      | (o.codeSize === 2 ? 0x08 : 0)
      | (o.supportsY420 ? 0x20 : 0)
      | ((o.codeType & 0x03) << 6)) & 0xff;
  }
  return ((o.codeSize === 2 ? 0x01 : 0)
    | (o.supportsY420 ? 0x04 : 0)
    | ((o.codeType & 0x03) << 3)
    | ((o.blockRevision & 0x07) << 5)) & 0xff;
}

/** Codes are packed little-endian, `codeSize` bytes each, until the payload runs out. */
export function parseTypeVIIICodes(payload: Uint8Array, codeSize: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + codeSize <= payload.length; i += codeSize) {
    out.push(codeSize === 2 ? payload[i]! | (payload[i + 1]! << 8) : payload[i]!);
  }
  return out;
}

export function buildTypeVIIICodes(codes: number[], codeSize: number): Uint8Array {
  const out = new Uint8Array(codes.length * codeSize);
  codes.forEach((c, i) => {
    out[i * codeSize] = c & 0xff;
    if (codeSize === 2) out[i * codeSize + 1] = (c >> 8) & 0xff;
  });
  return out;
}

// ------------------------------------------- DisplayID Dynamic Range Limits

export const DYNAMIC_RANGE_LIMITS_LENGTH = 9;

export interface DynamicRangeLimits {
  /** Pixel clocks are stored as (kHz - 1) in 3 little-endian bytes. */
  minPixelClockKhz: number;
  maxPixelClockKhz: number;
  minRefreshRateHz: number;
  maxRefreshRateHz: number;
  seamlessDynamicVideo: boolean;
  /** Bits 6:0 of the flags byte, preserved so a round-trip is byte-exact. */
  flagsReserved: number;
}

export function parseDynamicRangeLimits(p: Uint8Array): DynamicRangeLimits {
  if (p.length < DYNAMIC_RANGE_LIMITS_LENGTH) {
    throw new Error("Dynamic Range Limits block needs 9 bytes, got " + p.length);
  }
  const int3 = (at: number) => p[at]! | (p[at + 1]! << 8) | (p[at + 2]! << 16);
  return {
    minPixelClockKhz: int3(0) + 1,
    maxPixelClockKhz: int3(3) + 1,
    minRefreshRateHz: p[6]!,
    maxRefreshRateHz: p[7]!,
    seamlessDynamicVideo: bit(p[8]!, 7),
    flagsReserved: p[8]! & 0x7f,
  };
}

export function buildDynamicRangeLimits(d: DynamicRangeLimits): Uint8Array {
  const out = new Uint8Array(DYNAMIC_RANGE_LIMITS_LENGTH);
  const int3 = (at: number, v: number) => {
    out[at] = v & 0xff; out[at + 1] = (v >> 8) & 0xff; out[at + 2] = (v >> 16) & 0xff;
  };
  int3(0, d.minPixelClockKhz - 1);
  int3(3, d.maxPixelClockKhz - 1);
  out[6] = d.minRefreshRateHz & 0xff;
  out[7] = d.maxRefreshRateHz & 0xff;
  out[8] = ((d.seamlessDynamicVideo ? 0x80 : 0) | (d.flagsReserved & 0x7f)) & 0xff;
  return out;
}
