import { bits, bit, packBits, bytesToHex } from "./bytes.js";
import type { DisplayIdDataBlock } from "./types.js";

/**
 * DisplayID 1.x and 2.0 data blocks.
 *
 * Tag numbers and field layouts are taken from the decompiled
 * com.quantumdata.i980.core.edid.model.dispid.* classes, so they match what
 * ATP Manager itself reads and writes rather than a paraphrase of the spec.
 */

// -------------------------------------------------------------- tag registry

export const DidTag = {
  // DisplayID 1.x
  ProductIdV1: 0x00,
  DisplayParamsV1: 0x01,
  ColorCharacteristics: 0x02,
  TimingI: 0x03,
  TimingII: 0x04,
  TimingIII: 0x05,
  TimingIV: 0x06,
  TimingVesa: 0x07,
  TimingCta: 0x08,
  TimingRangeLimits: 0x09,
  ProductSerialNumber: 0x0a,
  AsciiString: 0x0b,
  DisplayDeviceData: 0x0c,
  PowerSequencing: 0x0d,
  TransferCharacteristics: 0x0e,
  DisplayInterfaceV1: 0x0f,
  StereoInterfaceV1: 0x10,
  TimingV: 0x11,
  TiledTopologyV1: 0x12,
  TimingVI: 0x13,
  // DisplayID 2.0
  ProductIdV2: 0x20,
  DisplayParamsV2: 0x21,
  TimingVII: 0x22,
  TimingVIII: 0x23,
  TimingIX: 0x24,
  DynamicRangeLimits: 0x25,
  DisplayInterfaceV2: 0x26,
  StereoInterfaceV2: 0x27,
  TiledTopologyV2: 0x28,
  ContainerId: 0x29,
  TimingX: 0x2a,
  AdaptiveSync: 0x2b,
  ArVrHmd: 0x2c,
  ArVrLayer: 0x2d,
  VendorSpecificV2: 0x7e,
  VendorSpecificV1: 0x7f,
  CtaData: 0x81,
} as const;

const TAG_LABELS: Record<number, string> = {
  [DidTag.ProductIdV1]: "Product Identification",
  [DidTag.DisplayParamsV1]: "Display Parameters",
  [DidTag.ColorCharacteristics]: "Color Characteristics",
  [DidTag.TimingI]: "Type I Timing - Detailed",
  [DidTag.TimingII]: "Type II Timing - Detailed",
  [DidTag.TimingIII]: "Type III Timing - Short",
  [DidTag.TimingIV]: "Type IV Timing - DMT ID Code",
  [DidTag.TimingVesa]: "VESA Timing Standard",
  [DidTag.TimingCta]: "CTA Timing Standard",
  [DidTag.TimingRangeLimits]: "Video Timing Range Limits",
  [DidTag.ProductSerialNumber]: "Product Serial Number",
  [DidTag.AsciiString]: "General Purpose ASCII String",
  [DidTag.DisplayDeviceData]: "Display Device Data",
  [DidTag.PowerSequencing]: "Interface Power Sequencing",
  [DidTag.TransferCharacteristics]: "Transfer Characteristics",
  [DidTag.DisplayInterfaceV1]: "Display Interface",
  [DidTag.StereoInterfaceV1]: "Stereo Display Interface",
  [DidTag.TimingV]: "Type V Timing - Short",
  [DidTag.TiledTopologyV1]: "Tiled Display Topology",
  [DidTag.TimingVI]: "Type VI Timing - Detailed",
  [DidTag.ProductIdV2]: "Product Identification v2",
  [DidTag.DisplayParamsV2]: "Display Parameters v2",
  [DidTag.TimingVII]: "Type VII Timing - Detailed",
  [DidTag.TimingVIII]: "Type VIII Timing - Enumerated Code",
  [DidTag.TimingIX]: "Type IX Timing - Formula Based",
  [DidTag.DynamicRangeLimits]: "Dynamic Video Timing Range Limits",
  [DidTag.DisplayInterfaceV2]: "Display Interface v2",
  [DidTag.StereoInterfaceV2]: "Stereo Display Interface v2",
  [DidTag.TiledTopologyV2]: "Tiled Display Topology v2",
  [DidTag.ContainerId]: "ContainerID",
  [DidTag.TimingX]: "Type X Timing - Formula Based",
  [DidTag.AdaptiveSync]: "Adaptive Sync",
  [DidTag.ArVrHmd]: "AR/VR HMD",
  [DidTag.ArVrLayer]: "AR/VR Layer",
  [DidTag.VendorSpecificV2]: "Vendor Specific v2",
  [DidTag.VendorSpecificV1]: "Vendor Specific",
  [DidTag.CtaData]: "CTA Data",
};

export function didTagLabel(tag: number): string {
  const known = TAG_LABELS[tag];
  if (known) return known;
  if (tag >= 0x14 && tag <= 0x1f) return "Reserved (VESA)";
  if (tag >= 0x2e && tag <= 0x7d) return "Reserved (VESA)";
  if (tag >= 0x82) return "Reserved (CTA)";
  return "Unknown (0x" + tag.toString(16).padStart(2, "0") + ")";
}

/** True for tags that only exist in DisplayID 2.0. */
export function isV2Tag(tag: number): boolean {
  return tag >= DidTag.ProductIdV2 && tag <= DidTag.ArVrLayer;
}

// ------------------------------------------------------- numeric primitives

/** IEEE 754 binary16 -> number, as used by DisplayID 2.0 luminance fields. */
export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 0x1f) return frac === 0 ? sign * Infinity : NaN;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

export function floatToHalf(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = value < 0 ? 0x8000 : 0;
  const v = Math.abs(value);
  if (v === 0) return sign;
  if (!Number.isFinite(v)) return sign | 0x7c00;
  if (v >= 65504) return sign | 0x7bff;

  let exp = Math.floor(Math.log2(v));
  if (exp < -14) return sign | Math.round(v / 2 ** -24);   // subnormal
  if (v / 2 ** exp >= 2) exp++;                             // log2 rounding guard
  const frac = Math.round((v / 2 ** exp - 1) * 1024);
  if (frac === 1024) return sign | ((exp + 1 + 15) << 10);
  return sign | ((exp + 15) << 10) | frac;
}

/** A pair of 12-bit CIE coordinates packed into 3 bytes (ColorCoord12). */
export interface ColorCoord12 { x: number; y: number }

export function readColorCoord12(b: Uint8Array, at: number): ColorCoord12 {
  const b0 = b[at] ?? 0, b1 = b[at + 1] ?? 0, b2 = b[at + 2] ?? 0;
  return { x: b0 | ((b1 & 0x0f) << 8), y: ((b1 >> 4) & 0x0f) | (b2 << 4) };
}

export function writeColorCoord12(c: ColorCoord12, out: number[]): void {
  out.push(c.x & 0xff, ((c.x >> 8) & 0x0f) | ((c.y & 0x0f) << 4), (c.y >> 4) & 0xff);
}

/** Raw 12-bit coordinate -> CIE value. */
export const coordToCie = (raw: number) => raw / 4096;

// ------------------------------------------------- Display Parameters (0x21)

export interface DidDisplayParamsV2 {
  horizontalImageSizeRaw: number;
  verticalImageSizeRaw: number;
  horizontalPixelCount: number;
  verticalPixelCount: number;
  scanOrientation: number;
  luminanceInfo: number;
  colorSpaceCie1976: boolean;
  audioSpeakerNotIntegrated: boolean;
  reservedFeature: boolean;
  primary1: ColorCoord12;
  primary2: ColorCoord12;
  primary3: ColorCoord12;
  white: ColorCoord12;
  maxLuminanceFull: number;
  maxLuminance10Percent: number;
  minLuminance: number;
  nativeColorDepth: number;
  displayDeviceTechnology: number;
  gammaRaw: number;
  trailing: Uint8Array;
}

export const DISPLAY_PARAMS_V2_LENGTH = 29;

export function parseDisplayParamsV2(p: Uint8Array): DidDisplayParamsV2 {
  if (p.length < DISPLAY_PARAMS_V2_LENGTH) {
    throw new Error(`Display Parameters v2 is ${p.length} bytes; ${DISPLAY_PARAMS_V2_LENGTH} required`);
  }
  const u16 = (at: number) => p[at]! | (p[at + 1]! << 8);
  const features = p[8]!;
  const colorAndTech = p[27]!;
  return {
    horizontalImageSizeRaw: u16(0),
    verticalImageSizeRaw: u16(2),
    horizontalPixelCount: u16(4),
    verticalPixelCount: u16(6),
    scanOrientation: bits(features, 2, 0),
    luminanceInfo: bits(features, 4, 3),
    reservedFeature: bit(features, 5),
    colorSpaceCie1976: bit(features, 6),
    audioSpeakerNotIntegrated: bit(features, 7),
    primary1: readColorCoord12(p, 9),
    primary2: readColorCoord12(p, 12),
    primary3: readColorCoord12(p, 15),
    white: readColorCoord12(p, 18),
    maxLuminanceFull: u16(21),
    maxLuminance10Percent: u16(23),
    minLuminance: u16(25),
    nativeColorDepth: bits(colorAndTech, 2, 0),
    displayDeviceTechnology: bits(colorAndTech, 6, 4),
    gammaRaw: p[28]!,
    trailing: Uint8Array.from(p.subarray(DISPLAY_PARAMS_V2_LENGTH)),
  };
}

export function buildDisplayParamsV2(d: DidDisplayParamsV2): Uint8Array {
  const out: number[] = [];
  const push16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);

  push16(d.horizontalImageSizeRaw);
  push16(d.verticalImageSizeRaw);
  push16(d.horizontalPixelCount);
  push16(d.verticalPixelCount);
  out.push(packBits(
    [2, 0, d.scanOrientation], [4, 3, d.luminanceInfo], [5, 5, +d.reservedFeature],
    [6, 6, +d.colorSpaceCie1976], [7, 7, +d.audioSpeakerNotIntegrated],
  ));
  writeColorCoord12(d.primary1, out);
  writeColorCoord12(d.primary2, out);
  writeColorCoord12(d.primary3, out);
  writeColorCoord12(d.white, out);
  push16(d.maxLuminanceFull);
  push16(d.maxLuminance10Percent);
  push16(d.minLuminance);
  out.push(packBits([2, 0, d.nativeColorDepth], [6, 4, d.displayDeviceTechnology]));
  out.push(d.gammaRaw & 0xff);
  out.push(...d.trailing);
  return Uint8Array.from(out);
}

/** Image size in mm. The multiplier flag lives in the block header's flags byte. */
export function imageSizeMm(raw: number, useMultiplier: boolean): number {
  return useMultiplier ? raw : raw / 10;
}

export const SCAN_ORIENTATION = [
  "Left to right, top to bottom", "Right to left, top to bottom",
  "Top to bottom, right to left", "Bottom to top, right to left",
  "Right to left, bottom to top", "Left to right, bottom to top",
  "Bottom to top, left to right", "Top to bottom, left to right",
] as const;

export const NATIVE_COLOR_DEPTH = ["undefined", "6 bpc", "8 bpc", "10 bpc", "12 bpc", "14 bpc", "16 bpc"] as const;

export const DISPLAY_DEVICE_TECH = [
  "undefined", "LCD", "OLED", "Plasma (PDP)", "Electroluminescent",
  "Electrophoretic", "Projector", "reserved",
] as const;

export const LUMINANCE_INFO = [
  "Min luminance not defined", "Min luminance is the lowest supported",
  "Min luminance is at maximum backlight", "reserved",
] as const;

// ------------------------------------------------------ Adaptive Sync (0x2b)

export interface AdaptiveSyncDescriptor {
  nativePanelRange: boolean;
  frameDurationIncreaseTolerant: boolean;
  frameDurationDecreaseTolerant: boolean;
  supportedModes: number;
  seamlessTransition: boolean;
  maxSingleFrameIncreaseCode: number;
  minRefreshRateHz: number;
  maxRefreshRateHz: number;
  maxSingleFrameDecreaseCode: number;
}

export const ADAPTIVE_SYNC_DESCRIPTOR_LENGTH = 6;

export function parseAdaptiveSync(p: Uint8Array): { descriptors: AdaptiveSyncDescriptor[]; trailing: Uint8Array } {
  const descriptors: AdaptiveSyncDescriptor[] = [];
  let i = 0;
  while (i + ADAPTIVE_SYNC_DESCRIPTOR_LENGTH <= p.length) {
    const o = p[i]!;
    descriptors.push({
      nativePanelRange: bit(o, 0),
      frameDurationIncreaseTolerant: bit(o, 1),
      supportedModes: bits(o, 3, 2),
      // Bit 4 is stored inverted: set means "no seamless transition".
      seamlessTransition: !bit(o, 4),
      frameDurationDecreaseTolerant: bit(o, 5),
      maxSingleFrameIncreaseCode: p[i + 1]!,
      minRefreshRateHz: p[i + 2]!,
      maxRefreshRateHz: p[i + 3]! | (p[i + 4]! << 8),
      maxSingleFrameDecreaseCode: p[i + 5]!,
    });
    i += ADAPTIVE_SYNC_DESCRIPTOR_LENGTH;
  }
  return { descriptors, trailing: Uint8Array.from(p.subarray(i)) };
}

export function buildAdaptiveSync(v: { descriptors: AdaptiveSyncDescriptor[]; trailing: Uint8Array }): Uint8Array {
  const out: number[] = [];
  for (const d of v.descriptors) {
    out.push(packBits(
      [0, 0, +d.nativePanelRange], [1, 1, +d.frameDurationIncreaseTolerant],
      [3, 2, d.supportedModes], [4, 4, d.seamlessTransition ? 0 : 1],
      [5, 5, +d.frameDurationDecreaseTolerant],
    ));
    out.push(d.maxSingleFrameIncreaseCode & 0xff);
    out.push(d.minRefreshRateHz & 0xff);
    out.push(d.maxRefreshRateHz & 0xff, (d.maxRefreshRateHz >> 8) & 0xff);
    out.push(d.maxSingleFrameDecreaseCode & 0xff);
  }
  out.push(...v.trailing);
  return Uint8Array.from(out);
}

/** Max single frame duration increase/decrease is stored in quarter-percent units. */
export const singleFrameDeltaPercent = (code: number) => code / 4;

export const ADAPTIVE_SYNC_MODES = [
  "Only Adaptive-Sync in the range",
  "Adaptive-Sync plus fixed refresh rates in the range",
  "Adaptive-Sync plus fixed rates, single frame duration change",
  "reserved",
] as const;

// -------------------------------------------------------- ContainerID (0x29)

/** 16-byte UUID formatted the usual 8-4-4-4-12 way. */
export function formatContainerId(p: Uint8Array): string {
  if (p.length < 16) return bytesToHex(p);
  const h = bytesToHex(p.subarray(0, 16));
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)]
    .join("-").toLowerCase();
}

// ----------------------------------------------- Tiled Display Topology (0x28)

/**
 * Tiled Display Topology, 22-byte payload.
 *
 *   [0]      tile capabilities
 *   [1..3]   counts and locations, one big-endian 24-bit field with the high
 *            two bits of each 6-bit value split into byte 1 (see hvCntLoc in
 *            TiledTopologyBlock)
 *   [4..5]   horizontal size - 1 (LE)      [6..7]  vertical size - 1 (LE)
 *   [8]      pixel multiplier
 *   [9..12]  top / bottom / right / left bezel sizes
 *   [13..15] vendor id      [16..17] product code (LE)   [18..21] serial (LE)
 */
export interface TiledTopology {
  tileCapabilities: number;
  horizontalTileCount: number;
  verticalTileCount: number;
  horizontalLocation: number;
  verticalLocation: number;
  horizontalSize: number;
  verticalSize: number;
  pixelMultiplier: number;
  bezel: { top: number; bottom: number; right: number; left: number };
  vendorId: Uint8Array;
  productCode: number;
  serialNumber: number;
  trailing: Uint8Array;
}

export const TILED_TOPOLOGY_LENGTH = 22;

export function parseTiledTopology(p: Uint8Array): TiledTopology {
  if (p.length < TILED_TOPOLOGY_LENGTH) {
    throw new Error("Tiled Display Topology is " + p.length + " bytes; " + TILED_TOPOLOGY_LENGTH + " required");
  }
  const hv = (p[1]! << 16) | (p[2]! << 8) | p[3]!;
  const six = (low: number, high: number) => (((hv >> low) & 0x0f) | (((hv >> high) & 0x03) << 4)) + 1;

  return {
    tileCapabilities: p[0]!,
    horizontalTileCount: six(4, 22),
    verticalTileCount: six(0, 20),
    horizontalLocation: six(12, 18),
    verticalLocation: six(8, 16),
    horizontalSize: (p[4]! | (p[5]! << 8)) + 1,
    verticalSize: (p[6]! | (p[7]! << 8)) + 1,
    pixelMultiplier: p[8]!,
    bezel: { top: p[9]!, bottom: p[10]!, right: p[11]!, left: p[12]! },
    vendorId: Uint8Array.from(p.subarray(13, 16)),
    productCode: p[16]! | (p[17]! << 8),
    serialNumber: (p[18]! | (p[19]! << 8) | (p[20]! << 16) | (p[21]! << 24)) >>> 0,
    trailing: Uint8Array.from(p.subarray(TILED_TOPOLOGY_LENGTH)),
  };
}

export function buildTiledTopology(t: TiledTopology): Uint8Array {
  const put = (value: number, low: number, high: number) => {
    const v = Math.max(0, Math.min(63, value - 1));
    hv |= (v & 0x0f) << low;
    hv |= ((v >> 4) & 0x03) << high;
  };
  let hv = 0;
  put(t.verticalTileCount, 0, 20);
  put(t.horizontalTileCount, 4, 22);
  put(t.verticalLocation, 8, 16);
  put(t.horizontalLocation, 12, 18);

  const out: number[] = [t.tileCapabilities & 0xff, (hv >> 16) & 0xff, (hv >> 8) & 0xff, hv & 0xff];
  const push16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  push16(t.horizontalSize - 1);
  push16(t.verticalSize - 1);
  out.push(t.pixelMultiplier & 0xff);
  out.push(t.bezel.top & 0xff, t.bezel.bottom & 0xff, t.bezel.right & 0xff, t.bezel.left & 0xff);
  const vid = Array.from(t.vendorId.subarray(0, 3));
  while (vid.length < 3) vid.push(0);
  out.push(...vid);
  push16(t.productCode);
  out.push(t.serialNumber & 0xff, (t.serialNumber >>> 8) & 0xff,
           (t.serialNumber >>> 16) & 0xff, (t.serialNumber >>> 24) & 0xff);
  out.push(...t.trailing);
  return Uint8Array.from(out);
}
