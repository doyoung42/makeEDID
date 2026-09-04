import { bits, bit, setBit } from "../bytes.js";

/**
 * Dolby Vision VSVDB, OUI 00-D0-46 (IEEE_ID 53318).
 *
 * No public specification for this block exists in this repository — the 43
 * registered standard PDFs contain no Dolby document and the LLM extractions
 * mention "Dolby" only inside an audio-codec list. The entire layout below comes
 * from the decompiled ATP Manager model classes
 * (`reference/decompiled/.../cea/dblock/dolby/DVData*.java`), which is this
 * project's strongest evidence tier.
 *
 * ⚠ There are **zero Dolby Vision blocks in the 1,397-file corpus**, so none of
 * this is covered by the corpus regression. It is verified only by synthetic
 * round-trip tests. The first real DV EDID to arrive is effectively its first
 * field test.
 */
export const DOLBY_VISION_OUI = 0x00d046;

export type DolbyVisionVariant =
  | "V0" | "V1_12B" | "V1_15B" | "V2" | "V4_10B" | "V4_20B" | "unknown";

/**
 * Vendor-data length per variant.
 *
 * `DolbyVisionVideoVersion` lists total block sizes (26/15/12/12/10/20) and
 * derives `vendorDataLength = length - 5` — the 5 being the tag/length byte, the
 * extended-tag byte and the 3 OUI bytes. `payload` here is already the vendor
 * data, so these are the block sizes minus 5.
 */
const VARIANT_VENDOR_LENGTH: Record<Exclude<DolbyVisionVariant, "unknown">, number> = {
  V0: 21, V1_15B: 10, V1_12B: 7, V2: 7, V4_10B: 5, V4_20B: 15,
};

/**
 * Variant is keyed by (version, vendor-data length) together, matching
 * `DolbyVisionVideoVersion.from(version, length)`. Version alone is ambiguous:
 * v1 has two sizes, and so does v4.
 */
export function dolbyVisionVariant(version: number, vendorLength: number): DolbyVisionVariant {
  switch (version) {
    case 0: return vendorLength === VARIANT_VENDOR_LENGTH.V0 ? "V0" : "unknown";
    case 1:
      if (vendorLength === VARIANT_VENDOR_LENGTH.V1_12B) return "V1_12B";
      return vendorLength === VARIANT_VENDOR_LENGTH.V1_15B ? "V1_15B" : "unknown";
    case 2: return vendorLength === VARIANT_VENDOR_LENGTH.V2 ? "V2" : "unknown";
    case 4:
      if (vendorLength === VARIANT_VENDOR_LENGTH.V4_10B) return "V4_10B";
      return vendorLength === VARIANT_VENDOR_LENGTH.V4_20B ? "V4_20B" : "unknown";
    default: return "unknown";
  }
}

export function dolbyVisionVendorLength(variant: DolbyVisionVariant): number | null {
  return variant === "unknown" ? null : VARIANT_VENDOR_LENGTH[variant];
}

export interface DolbyVisionVsvdb {
  version: number;
  variant: DolbyVisionVariant;
  /** Full vendor data including byte 0, preserved verbatim. */
  payload: Uint8Array;
}

export function parseDolbyVisionVsvdb(p: Uint8Array): DolbyVisionVsvdb {
  if (p.length < 1) throw new Error("Dolby Vision payload is empty");
  const version = bits(p[0]!, 7, 5);
  return { version, variant: dolbyVisionVariant(version, p.length), payload: Uint8Array.from(p) };
}

export function buildDolbyVisionVsvdb(v: DolbyVisionVsvdb): Uint8Array {
  const out = Uint8Array.from(v.payload);
  // Keep byte 0's version bits in sync with the edited version field.
  if (out.length > 0) out[0] = ((v.version & 0x07) << 5) | (out[0]! & 0x1f);
  return out;
}

// ------------------------------------------------------------ field access

/** Read a bit field from vendor byte `i`. Mirrors `DVData.f(i, lsb, numBits)`. */
const f = (p: Uint8Array, i: number, lsb: number, width: number): number =>
  bits(p[i] ?? 0, lsb + width - 1, lsb);

const b = (p: Uint8Array, i: number): boolean => bit(p[i] ?? 0, 0);

function writeField(p: Uint8Array, i: number, lsb: number, width: number, value: number): void {
  if (i >= p.length) return;
  const mask = ((1 << width) - 1) << lsb;
  p[i] = ((p[i]! & ~mask) | ((value << lsb) & mask)) & 0xff;
}

function writeBit(p: Uint8Array, i: number, n: number, on: boolean): void {
  if (i < p.length) p[i] = setBit(p[i]!, n, on) & 0xff;
}

/**
 * A 12-bit colour coordinate pair packed into 3 bytes at `at`.
 * `Coord12`: x = f(at,4,4) | b(at+1)<<4, y = f(at,0,4) | b(at+2)<<4.
 */
const coord12X = (p: Uint8Array, at: number) => f(p, at, 4, 4) | ((p[at + 1] ?? 0) << 4);
const coord12Y = (p: Uint8Array, at: number) => f(p, at, 0, 4) | ((p[at + 2] ?? 0) << 4);

function writeCoord12X(p: Uint8Array, at: number, v: number): void {
  writeField(p, at, 4, 4, v & 0x0f);
  if (at + 1 < p.length) p[at + 1] = (v >> 4) & 0xff;
}
function writeCoord12Y(p: Uint8Array, at: number, v: number): void {
  writeField(p, at, 0, 4, v & 0x0f);
  if (at + 2 < p.length) p[at + 2] = (v >> 4) & 0xff;
}

/**
 * A 10-bit coordinate in the 20-byte v4 layout: 8 low bits in their own byte,
 * 2 high bits packed into byte 5 or 6. Mirrors `Coord10.get`.
 */
function coord10(p: Uint8Array, index: number, isX: boolean): number {
  const lowOffset = 5 + 2 + index * 2 + (isX ? 0 : 1);
  const lsb = (index % 2 === 0 ? 4 : 0) + (isX ? 2 : 0);
  return (f(p, 5 + Math.floor(index / 2), lsb, 2) << 8) | (p[lowOffset] ?? 0);
}

function writeCoord10(p: Uint8Array, index: number, isX: boolean, v: number): void {
  const lowOffset = 5 + 2 + index * 2 + (isX ? 0 : 1);
  const lsb = (index % 2 === 0 ? 4 : 0) + (isX ? 2 : 0);
  if (lowOffset < p.length) p[lowOffset] = v & 0xff;
  writeField(p, 5 + Math.floor(index / 2), lsb, 2, (v >> 8) & 0x03);
}

/** One readable field of a Dolby Vision block. */
export interface DolbyField {
  key: string;
  label: string;
  value: number | boolean;
  kind: "number" | "boolean" | "enum";
  /** Vendor byte the field starts at, and how many bytes it spans. */
  offset: number;
  length: number;
  /** Physical meaning of a coded value, when there is one. */
  decoded?: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `unique(common, CV) = (common | CV) / 256` — DVData.unique. */
const unique = (common: number, cv: number) => round3((common | cv) / 256);

/**
 * Every field of a Dolby Vision block, by variant.
 *
 * Formulas are taken verbatim from the decompiled accessors: V1 luminance is
 * `100 + 50*CV` / `(CV/127)^2`, V2 PQ is `CV*20` / `2055 + CV*65`, 12-bit
 * coordinates divide by 4096 and 10-bit by 1024.
 */
export function dolbyVisionFields(v: DolbyVisionVsvdb): DolbyField[] {
  const p = v.payload;
  const out: DolbyField[] = [];
  const num = (key: string, label: string, value: number, offset: number, length: number, decoded?: string) =>
    out.push({ key, label, value, kind: "number", offset, length, decoded });
  const flag = (key: string, label: string, value: boolean, offset: number) =>
    out.push({ key, label, value, kind: "boolean", offset, length: 1 });
  const en = (key: string, label: string, value: number, offset: number, decoded?: string) =>
    out.push({ key, label, value, kind: "enum", offset, length: 1, decoded });

  switch (v.variant) {
    case "V0":
      flag("yuv422_12bit", "Supports YUV 4:2:2 12-bit", b(p, 0), 0);
      flag("p60", "Supports 2160p60", bit(p[0] ?? 0, 1), 0);
      flag("globalDimming", "Supports Global Dimming", bit(p[0] ?? 0, 2), 0);
      en("dmMajor", "DM Major Version", f(p, 16, 4, 4), 16);
      en("dmMinor", "DM Minor Version", f(p, 16, 0, 4), 16);
      num("targetMinPQ", "Target Min PQ (code)", f(p, 13, 4, 4) | ((p[14] ?? 0) << 4), 13, 2);
      num("targetMaxPQ", "Target Max PQ (code)", f(p, 13, 0, 4) | ((p[15] ?? 0) << 4), 13, 3);
      for (const [name, at] of [["Red", 1], ["Green", 4], ["Blue", 7], ["White", 10]] as const) {
        num(name.toLowerCase() + "X", name + " x (code)", coord12X(p, at), at, 2,
          round3(coord12X(p, at) / 4096).toFixed(4));
        num(name.toLowerCase() + "Y", name + " y (code)", coord12Y(p, at), at, 3,
          round3(coord12Y(p, at) / 4096).toFixed(4));
      }
      break;

    case "V1_12B":
    case "V1_15B": {
      flag("yuv422_12bit", "Supports YUV 4:2:2 12-bit", b(p, 0), 0);
      flag("p60", "Supports 2160p60", bit(p[0] ?? 0, 1), 0);
      flag("globalDimming", "Supports Global Dimming", b(p, 1), 1);
      en("dmVersion", "DM Version", f(p, 0, 2, 3), 0);
      en("colorimetry", "Colorimetry", b(p, 2) ? 1 : 0, 2, b(p, 2) ? "P3-D65" : "Rec.709");
      const maxCv = f(p, 1, 1, 7);
      const minCv = f(p, 2, 1, 7);
      num("targetMaxLum", "Target Max Luminance (code)", maxCv, 1, 1, 100 + 50 * maxCv + " cd/m²");
      num("targetMinLum", "Target Min Luminance (code)", minCv, 2, 1,
        round3((minCv / 127) ** 2) + " cd/m²");

      if (v.variant === "V1_12B") {
        en("lowLatency", "Low Latency", f(p, 3, 0, 2), 3);
        num("uniqueGx", "Unique Gx (code)", f(p, 4, 1, 7), 4, 1, String(unique(0, f(p, 4, 1, 7))));
        num("uniqueGy", "Unique Gy (code)", f(p, 5, 1, 7), 5, 1, String(unique(128, f(p, 5, 1, 7))));
        num("uniqueRx", "Unique Rx (code)", f(p, 6, 3, 5), 6, 1, String(unique(160, f(p, 6, 3, 5))));
        // Ry is split across three bytes.
        const ry = (f(p, 6, 0, 3) << 2) | (f(p, 5, 0, 1) << 1) | f(p, 4, 0, 1);
        num("uniqueRy", "Unique Ry (code)", ry, 4, 3, String(unique(64, ry)));
        num("uniqueBx", "Unique Bx (code)", f(p, 3, 5, 3), 3, 1, String(unique(32, f(p, 3, 5, 3))));
        num("uniqueBy", "Unique By (code)", f(p, 3, 2, 3), 3, 1, String(unique(8, f(p, 3, 2, 3))));
      } else {
        // 15-byte v1 stores full bytes, so every coordinate is simply CV/256.
        const coords: [string, string, number][] = [
          ["rx", "Rx", 4], ["ry", "Ry", 5], ["gx", "Gx", 6],
          ["gy", "Gy", 7], ["bx", "Bx", 8], ["by", "By", 9],
        ];
        for (const [key, label, at] of coords) {
          num(key, label + " (code)", p[at] ?? 0, at, 1, round3((p[at] ?? 0) / 256).toFixed(4));
        }
      }
      break;
    }

    case "V2": {
      flag("yuv422_12bit", "Supports YUV 4:2:2 12-bit", b(p, 0), 0);
      flag("dovi2", "Supports DoVi 2", bit(p[0] ?? 0, 1), 0);
      flag("gaming", "Supports Dolby Vision Gaming", b(p, 1), 1);
      flag("globalDimming", "Supports Global Dimming", bit(p[1] ?? 0, 2), 1);
      flag("parity", "Parity", bit(p[2] ?? 0, 2), 2);
      en("dmVersion", "DM Version", f(p, 0, 2, 3), 0);
      en("backltMinLuma", "Backlight Min Luma", f(p, 1, 0, 2), 1);
      en("interface", "Interface", f(p, 2, 0, 2), 2);
      en("support444", "Supports 10b/12b 4:4:4", (b(p, 3) ? 2 : 0) + (b(p, 4) ? 1 : 0), 3);
      const minCv = f(p, 1, 3, 5);
      const maxCv = f(p, 2, 3, 5);
      num("targetMinPQ", "Target Min PQ (code)", minCv, 1, 1, minCv * 20 + " (PQ)");
      num("targetMaxPQ", "Target Max PQ (code)", maxCv, 2, 1, 2055 + maxCv * 65 + " (PQ)");
      num("uniqueGx", "Unique Gx (code)", f(p, 3, 1, 7), 3, 1, String(unique(0, f(p, 3, 1, 7))));
      num("uniqueGy", "Unique Gy (code)", f(p, 4, 1, 7), 4, 1, String(unique(128, f(p, 4, 1, 7))));
      num("uniqueRx", "Unique Rx (code)", f(p, 5, 3, 5), 5, 1, String(unique(160, f(p, 5, 3, 5))));
      num("uniqueRy", "Unique Ry (code)", f(p, 6, 3, 5), 6, 1, String(unique(64, f(p, 6, 3, 5))));
      num("uniqueBx", "Unique Bx (code)", f(p, 5, 0, 3), 5, 1, String(unique(32, f(p, 5, 0, 3))));
      num("uniqueBy", "Unique By (code)", f(p, 6, 0, 3), 6, 1, String(unique(8, f(p, 6, 0, 3))));
      break;
    }

    case "V4_10B":
    case "V4_20B": {
      flag("vsemds", "Dolby VSEMDS Supported", bit(p[0] ?? 0, 4), 0);
      flag("tmaxTminPopulated", "Tmax/Tmin Populated", bit(p[0] ?? 0, 3), 0);
      flag("rgbwPresent", "RGBW (x,y) Present", bit(p[0] ?? 0, 2), 0);
      flag("dovi2", "Supports DoVi 2", b(p, 1), 1);
      en("interface", "Interface", f(p, 0, 0, 2), 0);
      num("targetMinPQ", "Target Min PQ (code)", coord12X(p, 2), 2, 2);
      num("targetMaxPQ", "Target Max PQ (code)", coord12Y(p, 2), 2, 3);

      if (v.variant === "V4_20B") {
        const names = ["Red", "Green", "Blue", "White"];
        names.forEach((name, index) => {
          const x = coord10(p, index, true);
          const y = coord10(p, index, false);
          num(name.toLowerCase() + "X", name + " x (code)", x,
            5 + Math.floor(index / 2), 3, round3(x / 1024).toFixed(4));
          num(name.toLowerCase() + "Y", name + " y (code)", y,
            5 + Math.floor(index / 2), 4, round3(y / 1024).toFixed(4));
        });
      }
      break;
    }

    default:
      break;
  }

  return out;
}

/** Write one field back. Returns false when the key is unknown for the variant. */
export function setDolbyVisionField(v: DolbyVisionVsvdb, key: string, value: number | boolean): boolean {
  const p = v.payload;
  const known = dolbyVisionFields(v).find((x) => x.key === key);
  if (!known) return false;
  const n = typeof value === "boolean" ? (value ? 1 : 0) : Math.round(value);
  const on = Boolean(n);

  switch (v.variant) {
    case "V0":
      switch (key) {
        case "yuv422_12bit": writeBit(p, 0, 0, on); return true;
        case "p60": writeBit(p, 0, 1, on); return true;
        case "globalDimming": writeBit(p, 0, 2, on); return true;
        case "dmMajor": writeField(p, 16, 4, 4, n); return true;
        case "dmMinor": writeField(p, 16, 0, 4, n); return true;
        case "targetMinPQ": writeField(p, 13, 4, 4, n & 0x0f); if (14 < p.length) p[14] = (n >> 4) & 0xff; return true;
        case "targetMaxPQ": writeField(p, 13, 0, 4, n & 0x0f); if (15 < p.length) p[15] = (n >> 4) & 0xff; return true;
      }
      for (const [name, at] of [["red", 1], ["green", 4], ["blue", 7], ["white", 10]] as const) {
        if (key === name + "X") { writeCoord12X(p, at, n); return true; }
        if (key === name + "Y") { writeCoord12Y(p, at, n); return true; }
      }
      return false;

    case "V1_12B":
    case "V1_15B":
      switch (key) {
        case "yuv422_12bit": writeBit(p, 0, 0, on); return true;
        case "p60": writeBit(p, 0, 1, on); return true;
        case "globalDimming": writeBit(p, 1, 0, on); return true;
        case "dmVersion": writeField(p, 0, 2, 3, n); return true;
        case "colorimetry": writeBit(p, 2, 0, on); return true;
        case "targetMaxLum": writeField(p, 1, 1, 7, n); return true;
        case "targetMinLum": writeField(p, 2, 1, 7, n); return true;
        case "lowLatency": writeField(p, 3, 0, 2, n); return true;
        case "uniqueGx": writeField(p, 4, 1, 7, n); return true;
        case "uniqueGy": writeField(p, 5, 1, 7, n); return true;
        case "uniqueRx": writeField(p, 6, 3, 5, n); return true;
        case "uniqueRy":
          writeField(p, 6, 0, 3, n >> 2);
          writeBit(p, 5, 0, (n & 2) !== 0);
          writeBit(p, 4, 0, (n & 1) !== 0);
          return true;
        case "uniqueBx": writeField(p, 3, 5, 3, n); return true;
        case "uniqueBy": writeField(p, 3, 2, 3, n); return true;
        case "rx": case "ry": case "gx": case "gy": case "bx": case "by": {
          const at = { rx: 4, ry: 5, gx: 6, gy: 7, bx: 8, by: 9 }[key]!;
          if (at < p.length) p[at] = n & 0xff;
          return true;
        }
      }
      return false;

    case "V2":
      switch (key) {
        case "yuv422_12bit": writeBit(p, 0, 0, on); return true;
        case "dovi2": writeBit(p, 0, 1, on); return true;
        case "gaming": writeBit(p, 1, 0, on); return true;
        case "globalDimming": writeBit(p, 1, 2, on); return true;
        case "parity": writeBit(p, 2, 2, on); return true;
        case "dmVersion": writeField(p, 0, 2, 3, n); return true;
        case "backltMinLuma": writeField(p, 1, 0, 2, n); return true;
        case "interface": writeField(p, 2, 0, 2, n); return true;
        case "support444": writeBit(p, 3, 0, (n & 2) !== 0); writeBit(p, 4, 0, (n & 1) !== 0); return true;
        case "targetMinPQ": writeField(p, 1, 3, 5, n); return true;
        case "targetMaxPQ": writeField(p, 2, 3, 5, n); return true;
        case "uniqueGx": writeField(p, 3, 1, 7, n); return true;
        case "uniqueGy": writeField(p, 4, 1, 7, n); return true;
        case "uniqueRx": writeField(p, 5, 3, 5, n); return true;
        case "uniqueRy": writeField(p, 6, 3, 5, n); return true;
        case "uniqueBx": writeField(p, 5, 0, 3, n); return true;
        case "uniqueBy": writeField(p, 6, 0, 3, n); return true;
      }
      return false;

    case "V4_10B":
    case "V4_20B":
      switch (key) {
        case "vsemds": writeBit(p, 0, 4, on); return true;
        case "tmaxTminPopulated": writeBit(p, 0, 3, on); return true;
        case "rgbwPresent": writeBit(p, 0, 2, on); return true;
        case "dovi2": writeBit(p, 1, 0, on); return true;
        case "interface": writeField(p, 0, 0, 2, n); return true;
        case "targetMinPQ": writeCoord12X(p, 2, n); return true;
        case "targetMaxPQ": writeCoord12Y(p, 2, n); return true;
      }
      {
        const names = ["red", "green", "blue", "white"];
        for (let i = 0; i < names.length; i++) {
          if (key === names[i] + "X") { writeCoord10(p, i, true, n); return true; }
          if (key === names[i] + "Y") { writeCoord10(p, i, false, n); return true; }
        }
      }
      return false;

    default:
      return false;
  }
}
