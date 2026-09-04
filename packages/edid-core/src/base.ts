import { bits, bit, checksumFor, BLOCK_SIZE } from "./bytes.js";
import { decodeDescriptor, encodeDescriptor, DESCRIPTOR_SIZE } from "./descriptors.js";
import type {
  BaseBlock, VideoInput, FeatureSupport, Chromaticity, StandardTiming, Descriptor,
} from "./types.js";

const EDID_HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

export function hasEdidHeader(block: Uint8Array): boolean {
  return EDID_HEADER.every((v, i) => block[i] === v);
}

export function decodeBaseBlock(b: Uint8Array): BaseBlock {
  const manufacturerId = decodeManufacturerId((b[8]! << 8) | b[9]!);
  const week = b[16]!;
  const yearByte = b[17]!;

  return {
    manufacturerId,
    productCode: (b[11]! << 8) | b[10]!,
    serialNumber: (b[15]! << 24) | (b[14]! << 16) | (b[13]! << 8) | b[12]!,
    manufactureWeek: week === 0xff ? 0 : week,
    manufactureYear: yearByte + 1990,
    modelYearFlag: week === 0xff,
    edidVersion: b[18]!,
    edidRevision: b[19]!,
    videoInput: decodeVideoInput(b[20]!),
    horizontalSizeCm: b[21]!,
    verticalSizeCm: b[22]!,
    gammaRaw: b[23]!,
    features: decodeFeatures(b[24]!),
    chromaticity: decodeChromaticity(b),
    establishedTimings: { byte0: b[35]!, byte1: b[36]!, byte2: b[37]! },
    standardTimings: decodeStandardTimings(b),
    descriptors: decodeDescriptors(b),
    extensionCount: b[126]!,
  };
}

export function encodeBaseBlock(m: BaseBlock): Uint8Array {
  const b = new Uint8Array(BLOCK_SIZE);
  b.set(EDID_HEADER, 0);

  const mfg = encodeManufacturerId(m.manufacturerId);
  b[8] = (mfg >> 8) & 0xff;
  b[9] = mfg & 0xff;
  b[10] = m.productCode & 0xff;
  b[11] = (m.productCode >> 8) & 0xff;
  b[12] = m.serialNumber & 0xff;
  b[13] = (m.serialNumber >>> 8) & 0xff;
  b[14] = (m.serialNumber >>> 16) & 0xff;
  b[15] = (m.serialNumber >>> 24) & 0xff;
  b[16] = m.modelYearFlag ? 0xff : m.manufactureWeek & 0xff;
  b[17] = (m.manufactureYear - 1990) & 0xff;
  b[18] = m.edidVersion;
  b[19] = m.edidRevision;
  b[20] = encodeVideoInput(m.videoInput);
  b[21] = m.horizontalSizeCm & 0xff;
  b[22] = m.verticalSizeCm & 0xff;
  b[23] = m.gammaRaw & 0xff;
  b[24] = encodeFeatures(m.features);
  encodeChromaticity(m.chromaticity, b);
  b[35] = m.establishedTimings.byte0;
  b[36] = m.establishedTimings.byte1;
  b[37] = m.establishedTimings.byte2;
  encodeStandardTimings(m.standardTimings, b);
  for (let i = 0; i < 4; i++) {
    const slot = m.descriptors[i];
    if (slot) b.set(encodeDescriptor(slot), 54 + i * DESCRIPTOR_SIZE);
  }
  b[126] = m.extensionCount & 0xff;
  b[127] = checksumFor(b);
  return b;
}

// ------------------------------------------------------------ manufacturer id

export function decodeManufacturerId(word: number): string {
  const letter = (v: number) => String.fromCharCode(64 + (v & 0x1f));
  return letter(word >> 10) + letter(word >> 5) + letter(word);
}

export function encodeManufacturerId(id: string): number {
  const v = (c: string) => (c.toUpperCase().charCodeAt(0) - 64) & 0x1f;
  const s = (id + "@@@").slice(0, 3);
  return (v(s[0]!) << 10) | (v(s[1]!) << 5) | v(s[2]!);
}

// ---------------------------------------------------------------- video input

function decodeVideoInput(v: number): VideoInput {
  if (bit(v, 7)) {
    return { kind: "digital", bitDepth: decodeBitDepth(bits(v, 6, 4)), videoInterface: bits(v, 3, 0) };
  }
  return {
    kind: "analog",
    signalLevel: bits(v, 6, 5),
    setupBlankToBlack: bit(v, 4),
    separateSyncSupported: bit(v, 3),
    compositeSyncSupported: bit(v, 2),
    syncOnGreenSupported: bit(v, 1),
    vsyncSerrated: bit(v, 0),
  };
}

function encodeVideoInput(v: VideoInput): number {
  if (v.kind === "digital") {
    return 0x80 | (encodeBitDepth(v.bitDepth) << 4) | (v.videoInterface & 0x0f);
  }
  return (
    ((v.signalLevel & 0x03) << 5) |
    (v.setupBlankToBlack ? 0x10 : 0) |
    (v.separateSyncSupported ? 0x08 : 0) |
    (v.compositeSyncSupported ? 0x04 : 0) |
    (v.syncOnGreenSupported ? 0x02 : 0) |
    (v.vsyncSerrated ? 0x01 : 0)
  );
}

/** Encoded 0..7 -> bits per colour. 0 = undefined, 7 = reserved. */
function decodeBitDepth(code: number): number {
  return code === 0 || code === 7 ? 0 : 4 + code * 2;
}
function encodeBitDepth(depth: number): number {
  return depth === 0 ? 0 : Math.max(0, Math.min(6, (depth - 4) / 2));
}

// ------------------------------------------------------------------- features

function decodeFeatures(v: number): FeatureSupport {
  return {
    standbySupported: bit(v, 7),
    suspendSupported: bit(v, 6),
    activeOffSupported: bit(v, 5),
    colorType: bits(v, 4, 3),
    srgbDefault: bit(v, 2),
    preferredTimingMode: bit(v, 1),
    continuousFrequency: bit(v, 0),
  };
}

function encodeFeatures(f: FeatureSupport): number {
  return (
    (f.standbySupported ? 0x80 : 0) |
    (f.suspendSupported ? 0x40 : 0) |
    (f.activeOffSupported ? 0x20 : 0) |
    ((f.colorType & 0x03) << 3) |
    (f.srgbDefault ? 0x04 : 0) |
    (f.preferredTimingMode ? 0x02 : 0) |
    (f.continuousFrequency ? 0x01 : 0)
  );
}

// --------------------------------------------------------------- chromaticity

function decodeChromaticity(b: Uint8Array): Chromaticity {
  const lo = (byteIndex: number, hi: number, loBit: number) => bits(b[byteIndex]!, hi, loBit);
  const build = (msb: number, low2: number) => (msb << 2) | low2;
  return {
    redX:   build(b[27]!, lo(25, 7, 6)),
    redY:   build(b[28]!, lo(25, 5, 4)),
    greenX: build(b[29]!, lo(25, 3, 2)),
    greenY: build(b[30]!, lo(25, 1, 0)),
    blueX:  build(b[31]!, lo(26, 7, 6)),
    blueY:  build(b[32]!, lo(26, 5, 4)),
    whiteX: build(b[33]!, lo(26, 3, 2)),
    whiteY: build(b[34]!, lo(26, 1, 0)),
  };
}

function encodeChromaticity(c: Chromaticity, b: Uint8Array): void {
  b[25] =
    ((c.redX & 0x03) << 6) | ((c.redY & 0x03) << 4) |
    ((c.greenX & 0x03) << 2) | (c.greenY & 0x03);
  b[26] =
    ((c.blueX & 0x03) << 6) | ((c.blueY & 0x03) << 4) |
    ((c.whiteX & 0x03) << 2) | (c.whiteY & 0x03);
  b[27] = (c.redX >> 2) & 0xff;
  b[28] = (c.redY >> 2) & 0xff;
  b[29] = (c.greenX >> 2) & 0xff;
  b[30] = (c.greenY >> 2) & 0xff;
  b[31] = (c.blueX >> 2) & 0xff;
  b[32] = (c.blueY >> 2) & 0xff;
  b[33] = (c.whiteX >> 2) & 0xff;
  b[34] = (c.whiteY >> 2) & 0xff;
}

// ----------------------------------------------------------- standard timings

function decodeStandardTimings(b: Uint8Array): (StandardTiming | null)[] {
  const out: (StandardTiming | null)[] = [];
  for (let i = 0; i < 8; i++) {
    const x = b[38 + i * 2]!;
    const y = b[39 + i * 2]!;
    // 0x01 0x01 is the "unused" marker.
    if (x === 0x01 && y === 0x01) { out.push(null); continue; }
    out.push({
      horizontalActive: (x + 31) * 8,
      aspectRatio: bits(y, 7, 6) as 0 | 1 | 2 | 3,
      refreshRate: bits(y, 5, 0) + 60,
    });
  }
  return out;
}

function encodeStandardTimings(list: (StandardTiming | null)[], b: Uint8Array): void {
  for (let i = 0; i < 8; i++) {
    const t = list[i] ?? null;
    if (!t) { b[38 + i * 2] = 0x01; b[39 + i * 2] = 0x01; continue; }
    b[38 + i * 2] = (t.horizontalActive / 8 - 31) & 0xff;
    b[39 + i * 2] = ((t.aspectRatio & 0x03) << 6) | ((t.refreshRate - 60) & 0x3f);
  }
}

// ------------------------------------------------------------------ descriptors

function decodeDescriptors(b: Uint8Array): Descriptor[] {
  const out: Descriptor[] = [];
  for (let i = 0; i < 4; i++) {
    const start = 54 + i * DESCRIPTOR_SIZE;
    out.push(decodeDescriptor(b.subarray(start, start + DESCRIPTOR_SIZE)));
  }
  return out;
}
