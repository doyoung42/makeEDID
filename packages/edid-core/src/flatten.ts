import type {
  Edid, Descriptor, CtaDataBlock, CtaExtension, DisplayIdExtension, DisplayIdDataBlock,
  DetailedTimingDescriptor, ShortVideoDescriptor,
} from "./types.js";
import { bytesToHex, splitBlocks, isChecksumValid, bits, BLOCK_SIZE } from "./bytes.js";
import {
  computeLayout, type Region, type EdidLayout, type CtaBlockRegion, type DidBlockRegion,
} from "./layout.js";
import {
  asVendorBlock, parseVsdb, ouiToString, OUI_NAMES, amdMinLuminance,
  THREE_D_STRUCTURES, entry3DByteLength, dolbyVisionFields, type VendorBlockRef,
} from "./vsdb/index.js";
import { describeVic } from "./vic.js";
import { CtaExtendedTag } from "./cta.js";
import {
  DidTag, didTagLabel, parseDisplayParamsV2, parseAdaptiveSync, parseTiledTopology,
  formatContainerId, halfToFloat, coordToCie, imageSizeMm,
  SCAN_ORIENTATION, LUMINANCE_INFO, NATIVE_COLOR_DEPTH, DISPLAY_DEVICE_TECH,
  ADAPTIVE_SYNC_MODES, singleFrameDeltaPercent, type ColorCoord12,
} from "./displayid2.js";
import {
  parseTypeITiming, parseTypeVIITiming, parseTypeXTiming, TYPE_X_BASE_LENGTH,
  parseTypeVIIIOptions, parseTypeVIIICodes, TIMING_CODE_TYPE_LABEL,
  parseDynamicRangeLimits,
} from "./displayidTiming.js";

/**
 * The bytes a row occupies, relative to the start of its 128-byte block.
 *
 * When a field's bytes are not contiguous — chromaticity coordinates share a
 * low-order-bits byte, DTD sub-fields share a high-bits byte — this is the
 * smallest contiguous range covering every byte the field touches. The rule is
 * "the bytes that change if this row is edited", so the highlight can be one or
 * two bytes wider than the field itself in those few cases.
 */
export interface ByteSpan {
  blockIndex: number;
  byteOffset: number;
  byteLength: number;
}

/** Structural rows (`block`, `group`) frame the tree; `field` rows are leaves. */
export type FieldRole = "block" | "group" | "field";

/**
 * One comparable row in the spec matrix. `path` is a stable identity so the
 * same field lines up across models even when block ordering differs.
 */
export interface SpecField {
  path: string;
  group: string;
  label: string;
  value: string | number | boolean | null;
  kind: "string" | "number" | "boolean" | "hex" | "enum";
  /** null when the row has no single byte range (counts and other aggregates). */
  span: ByteSpan | null;
  /** Path of the enclosing structural row, or null at the top. */
  parent: string | null;
  role: FieldRole;
}

const GROUP = {
  base: "Base EDID",
  timing: "Timings",
  cta: "CTA-861",
  audio: "Audio",
  hdr: "HDR",
  displayid: "DisplayID",
  structure: "Structure",
} as const;

/**
 * Row sink.
 *
 * Calling it directly keeps the original five-argument form and emits a row
 * with no byte span. `at()` adds an offset relative to the current scope, and
 * `scope()` emits a structural row and returns an emitter anchored to it — so
 * leaf offsets stay small constants no matter where the enclosing block landed.
 */
export interface Emitter {
  (path: string, group: string, label: string, value: SpecField["value"], kind?: SpecField["kind"]): void;
  at(
    rel: number, len: number,
    path: string, group: string, label: string,
    value: SpecField["value"], kind?: SpecField["kind"],
  ): void;
  scope(
    path: string, group: string, label: string,
    value: SpecField["value"], kind: SpecField["kind"],
    region: Region | null, role: FieldRole,
  ): Emitter;
}

/** Retained for readability at call sites that only ever emit leaves. */
type Add = Emitter;

/**
 * Names for CTA extended tags, taken from ATP Manager's own CeaBlockTag table
 * (its codes are `tag << 8 | extendedTag`, so 1826 there is 0x22 here).
 */
const EXTENDED_TAG_LABEL: Record<number, string> = {
  0x00: "Video Capability",
  0x01: "Vendor Specific Video",
  0x02: "VESA Video Display Info",
  0x03: "VESA Video",
  0x04: "HDMI Video",
  0x05: "Colorimetry",
  0x06: "HDR Static Metadata",
  0x07: "HDR Dynamic Metadata",
  0x08: "Native Video Resolution",
  0x0d: "Video Format Preferences",
  0x0e: "YCbCr 4:2:0 Video Data",
  0x0f: "YCbCr 4:2:0 Capability Map",
  0x10: "Misc Audio",
  0x11: "Vendor Specific Audio",
  0x12: "HDMI Audio",
  0x13: "Room Configuration",
  0x14: "Speaker Location",
  0x20: "InfoFrame",
  0x21: "Product Information",
  0x22: "Type VII Video Timing",
  0x23: "Type VIII Video Timing",
  0x2a: "Type X Video Timing",
  0x78: "HDMI Forum EDID Extension Override",
  0x79: "HDMI Forum Sink Capabilities",
  0x7a: "HDMI Forum SBTM",
};

export function extendedTagLabel(tag: number): string {
  return EXTENDED_TAG_LABEL[tag] ?? "Extended tag 0x" + tag.toString(16).padStart(2, "0");
}

function toSpan(r: Region): ByteSpan {
  return { blockIndex: r.blockIndex, byteOffset: r.offset, byteLength: r.length };
}

function makeEmitter(out: SpecField[], region: Region | null, parent: string | null): Emitter {
  const emit = ((path, group, label, value, kind = "string") => {
    out.push({ path, group, label, value, kind, span: null, parent, role: "field" });
  }) as Emitter;

  emit.at = (rel, len, path, group, label, value, kind = "string") => {
    out.push({
      path, group, label, value, kind,
      span: region ? { blockIndex: region.blockIndex, byteOffset: region.offset + rel, byteLength: len } : null,
      parent,
      role: "field",
    });
  };

  emit.scope = (path, group, label, value, kind, r, role) => {
    out.push({ path, group, label, value, kind, span: r ? toSpan(r) : null, parent, role });
    return makeEmitter(out, r, path);
  };

  return emit;
}

/**
 * Flatten an EDID into comparable rows.
 *
 * `bytes` is optional: pass the encoded form when you already have it and the
 * checksum rows carry real values. It is never computed here — this runs in a
 * render path per model, and `encodeEdid` can throw on a half-edited model.
 */
export function flattenEdid(edid: Edid, bytes?: Uint8Array): SpecField[] {
  const out: SpecField[] = [];
  const layout = computeLayout(edid);
  const blocks = bytes ? splitBlocks(bytes) : null;
  const root = makeEmitter(out, null, null);

  const blockScope = (i: number, label: string, group: string) => {
    const bl = layout.blocks[i]!;
    const raw = blocks?.[i];
    const summary = raw
      ? (isChecksumValid(raw) ? "checksum OK" : "checksum INVALID")
      : String(bl.kind);
    const scope = root.scope("block" + i, group, label, summary, "string", bl.whole, "block");
    if (raw) {
      scope.at(BLOCK_SIZE - 1, 1, "block" + i + ".checksum", group, "Block Checksum",
        "0x" + raw[BLOCK_SIZE - 1]!.toString(16).padStart(2, "0").toUpperCase(), "hex");
    }
    return scope;
  };

  flattenBase(edid, blockScope(0, "Block 0 — Base EDID", GROUP.base), layout);

  edid.extensions.forEach((ext, i) => {
    const n = i + 1;
    if (ext.kind === "cta") {
      flattenCta(ext, i, blockScope(n, "Block " + n + " — CTA-861", GROUP.cta), layout);
    } else if (ext.kind === "displayid") {
      flattenDisplayId(ext, i, blockScope(n, "Block " + n + " — DisplayID", GROUP.displayid), layout);
    } else {
      const tag = ext.tag.toString(16);
      const scope = blockScope(n, "Block " + n + " — tag 0x" + tag, GROUP.base);
      scope.at(0, BLOCK_SIZE, "ext" + i + ".raw", GROUP.base,
        "Extension " + i + " (tag 0x" + tag + ")", bytesToHex(ext.raw), "hex");
    }
  });

  return out;
}

function flattenBase(edid: Edid, add: Emitter, layout: EdidLayout): void {
  const b = edid.base;
  add.at(8, 2, "base.manufacturer", GROUP.base, "Manufacturer ID", b.manufacturerId);
  add.at(10, 2, "base.productCode", GROUP.base, "Product Code", b.productCode, "number");
  add.at(12, 4, "base.serialNumber", GROUP.base, "Serial Number", b.serialNumber, "number");
  add.at(16, 1, "base.week", GROUP.base, b.modelYearFlag ? "Model Year Flag" : "Manufacture Week",
    b.modelYearFlag ? "model year" : b.manufactureWeek, "number");
  add.at(17, 1, "base.year", GROUP.base, "Year", b.manufactureYear, "number");
  add.at(18, 2, "base.edidVersion", GROUP.base, "EDID Version", b.edidVersion + "." + b.edidRevision);
  add.at(18, 1, "base.edidVersionMajor", GROUP.base, "EDID Version (major)", b.edidVersion, "number");
  add.at(19, 1, "base.edidRevision", GROUP.base, "EDID Revision (minor)", b.edidRevision, "number");

  const vi = b.videoInput;
  add.at(20, 1, "base.input.kind", GROUP.base, "Video Input", vi.kind, "enum");
  if (vi.kind === "digital") {
    add.at(20, 1, "base.input.bitDepth", GROUP.base, "Bit Depth (bpc, 0 = undefined)",
      vi.bitDepth, "enum");
    add.at(20, 1, "base.input.interface", GROUP.base, "Digital Interface", vi.videoInterface, "enum");
  }

  add.at(21, 1, "base.sizeH", GROUP.base, "Horizontal Size (cm)", b.horizontalSizeCm, "number");
  add.at(22, 1, "base.sizeV", GROUP.base, "Vertical Size (cm)", b.verticalSizeCm, "number");
  add.at(23, 1, "base.gamma", GROUP.base, "Gamma",
    b.gammaRaw === 0xff ? "defined by DI-EXT" : (b.gammaRaw + 100) / 100, "number");
  add.at(24, 1, "base.srgb", GROUP.base, "sRGB Default", b.features.srgbDefault, "boolean");
  add.at(24, 1, "base.preferredTiming", GROUP.base, "Preferred Timing Mode", b.features.preferredTimingMode, "boolean");
  add.at(24, 1, "base.continuousFreq", GROUP.base, "Continuous Frequency", b.features.continuousFrequency, "boolean");

  const c = b.chromaticity;
  const coord = (v: number) => (v / 1024).toFixed(4);
  // The 10-bit raw codes are what can actually be written; the "x, y" rows above
  // stay as the readable summary.
  // [key, label, value, sharedLowByte, highByte] — the 2 low bits live in byte
  // 25 (red/green) or 26 (blue/white), the 8 high bits in the coordinate's own
  // byte, so each span runs from the shared byte through the high byte.
  const CHROMA: [string, string, number, number, number][] = [
    ["redX", "Red x", c.redX, 25, 27], ["redY", "Red y", c.redY, 25, 28],
    ["greenX", "Green x", c.greenX, 25, 29], ["greenY", "Green y", c.greenY, 25, 30],
    ["blueX", "Blue x", c.blueX, 26, 31], ["blueY", "Blue y", c.blueY, 26, 32],
    ["whiteX", "White x", c.whiteX, 26, 33], ["whiteY", "White y", c.whiteY, 26, 34],
  ];
  add.at(25, 4, "base.chroma.red", GROUP.base, "Red (x, y)", coord(c.redX) + ", " + coord(c.redY));
  add.at(25, 6, "base.chroma.green", GROUP.base, "Green (x, y)", coord(c.greenX) + ", " + coord(c.greenY));
  add.at(26, 4, "base.chroma.blue", GROUP.base, "Blue (x, y)", coord(c.blueX) + ", " + coord(c.blueY));
  add.at(26, 6, "base.chroma.white", GROUP.base, "White (x, y)", coord(c.whiteX) + ", " + coord(c.whiteY));

  for (const [key, label, value, lowByte, highByte] of CHROMA) {
    add.at(lowByte, highByte - lowByte + 1, "base.chroma." + key, GROUP.base,
      label + " (10-bit code)", value, "number");
  }

  add.at(126, 1, "base.extensionCount", GROUP.base, "Extension Count", b.extensionCount, "number");

  // Power/colour bits that share byte 24 with the sRGB / preferred-timing flags.
  add.at(24, 1, "base.features.standby", GROUP.base, "Standby Supported", b.features.standbySupported, "boolean");
  add.at(24, 1, "base.features.suspend", GROUP.base, "Suspend Supported", b.features.suspendSupported, "boolean");
  add.at(24, 1, "base.features.activeOff", GROUP.base, "Active Off Supported", b.features.activeOffSupported, "boolean");
  add.at(24, 1, "base.features.colorType", GROUP.base, "Colour Encoding", b.features.colorType, "enum");

  // Established timings: 17 well-known modes as bit flags across bytes 35-37.
  // Names from EstTypeI/EstTypeII/EstManf in the decompiled ATP Manager.
  const est = add.scope("base.estTimings", GROUP.timing, "Established Timings",
    ESTABLISHED_TIMINGS.filter(([, , , byteIdx, bit]) =>
      ((byteIdx === 0 ? b.establishedTimings.byte0
        : byteIdx === 1 ? b.establishedTimings.byte1
        : b.establishedTimings.byte2) >> bit) & 1).length + " enabled",
    "string", { blockIndex: 0, offset: 35, length: 3 }, "group");
  for (const [key, label, , byteIdx, bit] of ESTABLISHED_TIMINGS) {
    const raw = byteIdx === 0 ? b.establishedTimings.byte0
      : byteIdx === 1 ? b.establishedTimings.byte1 : b.establishedTimings.byte2;
    est.at(byteIdx, 1, "base.est." + key, GROUP.timing, label, ((raw >> bit) & 1) === 1, "boolean");
  }

  // Standard timings: 8 two-byte slots from byte 38. 0x01 0x01 marks a slot unused.
  b.standardTimings.forEach((t, i) => {
    const at = 38 + i * 2;
    const slot = add.scope("base.std" + i, GROUP.timing, "Standard Timing " + (i + 1),
      t ? t.horizontalActive + " @ " + t.refreshRate + " Hz" : "unused", "string",
      { blockIndex: 0, offset: at, length: 2 }, "group");
    slot.at(0, 2, "base.std" + i + ".used", GROUP.timing,
      "Standard Timing " + (i + 1) + " · Used", t !== null, "boolean");
    if (t) {
      slot.at(0, 1, "base.std" + i + ".hActive", GROUP.timing,
        "Standard Timing " + (i + 1) + " · H Active (px)", t.horizontalActive, "number");
      slot.at(1, 1, "base.std" + i + ".aspect", GROUP.timing,
        "Standard Timing " + (i + 1) + " · Aspect Ratio", t.aspectRatio, "enum");
      slot.at(1, 1, "base.std" + i + ".refresh", GROUP.timing,
        "Standard Timing " + (i + 1) + " · Refresh (Hz)", t.refreshRate, "number");
    }
  });

  b.descriptors.forEach((d, i) => {
    const path = "base.desc" + i;
    const label = "Descriptor " + (i + 1);
    const region = layout.blocks[0]?.descriptors?.[i] ?? null;
    // A descriptor slot is a container so its 18 bytes highlight as a unit.
    const scope = add.scope(path, GROUP.base, label, describeDescriptor(d), "string", region, "group");
    flattenDescriptor(d, path, label, scope);
  });
}

/** One-line summary shown on the descriptor's own row. */
function describeDescriptor(d: Descriptor): string {
  switch (d.kind) {
    case "product-name":   return "Product Name";
    case "serial-number":  return "Serial Number";
    case "text":           return "Text";
    case "range-limits":   return "Display Range Limits";
    case "detailed-timing": return describeDtd(d);
    case "unknown":        return d.tag === null || d.tag === 0x10 ? "unused" : "tag 0x" + d.tag.toString(16);
  }
}

function flattenDescriptor(d: Descriptor, path: string, label: string, add: Add): void {
  switch (d.kind) {
    case "product-name":
      add.at(5, 13, path + ".name", GROUP.base, "Product Name", d.text);
      break;
    case "serial-number":
      add.at(5, 13, path + ".serial", GROUP.base, "Serial (text)", d.text);
      break;
    case "text":
      add.at(5, 13, path + ".text", GROUP.base, label + " Text", d.text);
      break;
    case "range-limits":
      add.at(4, 3, path + ".vRange", GROUP.timing, "Vertical Rate (Hz)", d.minVerticalHz + "-" + d.maxVerticalHz);
      add.at(4, 5, path + ".hRange", GROUP.timing, "Horizontal Rate (kHz)", d.minHorizontalKhz + "-" + d.maxHorizontalKhz);
      // Each limit spans its own byte plus byte 4, which holds the +255 offset bit.
      add.at(4, 2, path + ".vMin", GROUP.timing, "Vertical Rate Min (Hz)", d.minVerticalHz, "number");
      add.at(4, 3, path + ".vMax", GROUP.timing, "Vertical Rate Max (Hz)", d.maxVerticalHz, "number");
      add.at(4, 4, path + ".hMin", GROUP.timing, "Horizontal Rate Min (kHz)", d.minHorizontalKhz, "number");
      add.at(4, 5, path + ".hMax", GROUP.timing, "Horizontal Rate Max (kHz)", d.maxHorizontalKhz, "number");
      add.at(9, 1, path + ".maxClock", GROUP.timing, "Max Pixel Clock (MHz)", d.maxPixelClockMhz, "number");
      add.at(10, 1, path + ".timingSupport", GROUP.timing, "Timing Support Flags", d.timingSupport, "enum");
      break;
    case "detailed-timing":
      add.at(0, 18, path + ".dtd", GROUP.timing, label + " (DTD)", describeDtd(d));
      flattenDtd(d, path + ".dtd", label, add);
      break;
    case "unknown":
      if (d.tag !== null && d.tag !== 0x10) {
        add.at(0, 18, path + ".raw", GROUP.base, label + " (tag 0x" + d.tag.toString(16) + ")", bytesToHex(d.raw), "hex");
      }
      break;
  }
}

interface DtdLike {
  hActive: number; vActive: number; hBlank: number; vBlank: number;
  pixelClockKhz: number; interlaced: boolean;
}

/**
 * The 18-byte detailed timing, field by field.
 *
 * Offsets are relative to the descriptor start and follow `encodeDetailedTiming`
 * (descriptors.ts). Several fields share a byte of high bits — hActive and
 * hBlank both live partly in byte 4, and the four sync values all share byte 11
 * — so each span is the smallest contiguous range covering every byte the field
 * touches, per the ByteSpan rule.
 */
function flattenDtd(d: DetailedTimingDescriptor, key: string, label: string, add: Emitter): void {
  const g = GROUP.timing;
  const pre = label + " · ";
  add.at(0, 2, key + ".clock", g, label + " Pixel Clock (kHz)", d.pixelClockKhz, "number");
  add.at(2, 3, key + ".hActive", g, pre + "H Active (px)", d.hActive, "number");
  add.at(3, 2, key + ".hBlank", g, pre + "H Blank (px)", d.hBlank, "number");
  add.at(5, 3, key + ".vActive", g, pre + "V Active (lines)", d.vActive, "number");
  add.at(6, 2, key + ".vBlank", g, pre + "V Blank (lines)", d.vBlank, "number");
  add.at(8, 4, key + ".hSyncOffset", g, pre + "H Sync Offset (px)", d.hSyncOffset, "number");
  add.at(9, 3, key + ".hSyncPulse", g, pre + "H Sync Pulse (px)", d.hSyncPulse, "number");
  add.at(10, 2, key + ".vSyncOffset", g, pre + "V Sync Offset (lines)", d.vSyncOffset, "number");
  add.at(10, 2, key + ".vSyncPulse", g, pre + "V Sync Pulse (lines)", d.vSyncPulse, "number");
  add.at(12, 3, key + ".hSizeMm", g, pre + "H Image Size (mm)", d.hSizeMm, "number");
  add.at(13, 2, key + ".vSizeMm", g, pre + "V Image Size (mm)", d.vSizeMm, "number");
  add.at(15, 1, key + ".hBorder", g, pre + "H Border (px)", d.hBorder, "number");
  add.at(16, 1, key + ".vBorder", g, pre + "V Border (lines)", d.vBorder, "number");
  add.at(17, 1, key + ".interlaced", g, pre + "Interlaced", d.interlaced, "boolean");
  add.at(17, 1, key + ".stereo", g, pre + "Stereo Mode", d.stereo, "enum");
  add.at(17, 1, key + ".syncType", g, pre + "Sync Type", d.syncType, "enum");
  add.at(17, 1, key + ".syncFlags", g, pre + "Sync Flags", d.syncFlags, "enum");
}

/**
 * Type VII detailed timing. `optionsByte` carries T7_M in bits 6:4, which sets
 * how many bytes the descriptor has beyond its 20-byte base.
 */
function flattenTypeVII(payload: Uint8Array, optionsByte: number, key: string, add: Emitter): void {
  const extra = bits(optionsByte, 6, 4);
  const t = parseTypeVIITiming(payload, extra);
  const g = GROUP.timing;
  const k = key + ".t7";
  add.at(0, 3, k + ".clock", g, "Type VII · Pixel Clock (MHz)", t.pixelClockMhz, "number");
  add.at(3, 1, k + ".aspect", g, "Type VII · Aspect Ratio", t.aspectRatio, "enum");
  add.at(3, 1, k + ".interlaced", g, "Type VII · Interlaced", t.interlaced, "boolean");
  add.at(3, 1, k + ".y420", g, "Type VII · Supports YCbCr 4:2:0", t.supportsY420, "boolean");
  add.at(3, 1, k + ".support3d", g, "Type VII · 3D Support", t.support3d, "enum");
  add.at(4, 2, k + ".hActive", g, "Type VII · H Active (px)", t.hActive, "number");
  add.at(6, 2, k + ".hBlank", g, "Type VII · H Blank (px)", t.hBlank, "number");
  add.at(8, 2, k + ".hSyncOffset", g, "Type VII · H Sync Offset (px)", t.hSyncOffset, "number");
  add.at(8, 2, k + ".hSyncPositive", g, "Type VII · H Sync Positive", t.hSyncPositive, "boolean");
  add.at(10, 2, k + ".hSyncWidth", g, "Type VII · H Sync Width (px)", t.hSyncWidth, "number");
  add.at(12, 2, k + ".vActive", g, "Type VII · V Active (lines)", t.vActive, "number");
  add.at(14, 2, k + ".vBlank", g, "Type VII · V Blank (lines)", t.vBlank, "number");
  add.at(16, 2, k + ".vSyncOffset", g, "Type VII · V Sync Offset (lines)", t.vSyncOffset, "number");
  add.at(16, 2, k + ".vSyncPositive", g, "Type VII · V Sync Positive", t.vSyncPositive, "boolean");
  add.at(18, 2, k + ".vSyncWidth", g, "Type VII · V Sync Width (lines)", t.vSyncWidth, "number");
}

/**
 * Type VIII enumerated timing codes. One size knob (1 or 2 bytes) applies to
 * every code, and the count is whatever fits — the same packing rule as
 * Type VII/X, but the option bits live at different offsets per carrier.
 */
function flattenTypeVIII(
  payload: Uint8Array, optionsByte: number, carrier: "cta" | "displayid",
  key: string, add: Emitter,
): void {
  const o = parseTypeVIIIOptions(optionsByte, carrier);
  const codes = parseTypeVIIICodes(payload, o.codeSize);
  const g = GROUP.timing;
  const k = key + ".t8";
  add(k + ".revision", g, "Type VIII · Block Revision", o.blockRevision, "number");
  add(k + ".codeSize", g, "Type VIII · Code Size (bytes)", o.codeSize, "number");
  add(k + ".y420", g, "Type VIII · Supports YCbCr 4:2:0", o.supportsY420, "boolean");
  // The code, not the label — enum rows carry raw codes so the writer can take
  // them straight back. `describeInput` supplies the labelled dropdown.
  add(k + ".codeType", g, "Type VIII · Code Type ("
    + (TIMING_CODE_TYPE_LABEL[o.codeType] ?? "?") + ")", o.codeType, "enum");
  add(k + ".count", g, "Type VIII · Timing Code Count", codes.length, "number");
  // A homogeneous list of scalars, so it is edited as one comma-separated row
  // rather than exploding into one row per code.
  add.at(0, payload.length, k + ".codes", g, "Type VIII · Timing Codes",
    codes.join(", "), "string");
}

/**
 * Type X formula-based timings. One length knob (`optionsByte` bits 6:4) sets
 * the stride for every entry; the count is whatever fits in the payload.
 */
function flattenTypeX(
  payload: Uint8Array, optionsByte: number, key: string, add: Emitter, anchor: Region | null,
): void {
  const extra = bits(optionsByte, 6, 4);
  const stride = TYPE_X_BASE_LENGTH + extra;
  const g = GROUP.timing;

  for (let i = 0, n = 0; i + stride <= payload.length; i += stride, n++) {
    let t;
    try {
      t = parseTypeXTiming(payload.subarray(i, i + stride), extra);
    } catch {
      continue;
    }
    const k = key + ".tx" + n;
    const label = "Type X " + (n + 1) + " · ";
    // Each entry gets its own region so its fields anchor to the right bytes.
    const entryRegion: Region | null = anchor
      ? { blockIndex: anchor.blockIndex, offset: anchor.offset + i, length: stride }
      : null;
    const scope = add.scope(k, g, "Type X Timing " + (n + 1),
      t.hActive + "x" + t.vActive + " @ " + t.refreshHz + " Hz", "string",
      entryRegion, "group");
    scope.at(0, 1, k + ".algorithm", g, label + "Formula", t.algorithm, "enum");
    scope.at(0, 1, k + ".y420", g, label + "Supports YCbCr 4:2:0", t.supportsY420, "boolean");
    scope.at(0, 1, k + ".support3d", g, label + "3D Support", t.support3d, "enum");
    scope.at(1, 2, k + ".hActive", g, label + "H Active (px)", t.hActive, "number");
    scope.at(3, 2, k + ".vActive", g, label + "V Active (lines)", t.vActive, "number");
    // With an extra byte the rate widens from 8 to 10 bits, so the span grows.
    scope.at(5, extra >= 1 ? 2 : 1, k + ".refresh", g, label + "Refresh Rate (Hz)", t.refreshHz, "number");
    if (t.deltaHBlank !== null) {
      scope.at(6, 1, k + ".deltaHBlank", g, label + "H Blank Delta (code)", t.deltaHBlank, "number");
      scope.at(6, 1, k + ".deltaVBlank", g, label + "V Blank Delta (code)", t.deltaVBlank ?? 0, "number");
    }
    if (t.altMinVblank !== null) {
      scope.at(7, 1, k + ".altMinVblank", g, label + "Alt Min V Blank", t.altMinVblank, "boolean");
    }
  }
}

function describeDtd(d: DtdLike): string {
  const total = (d.hActive + d.hBlank) * (d.vActive + d.vBlank);
  const hz = total > 0 ? (d.pixelClockKhz * 1000) / total : 0;
  return d.hActive + "x" + d.vActive + (d.interlaced ? "i" : "p") + " @ " + hz.toFixed(2) + " Hz";
}

function flattenCta(ext: CtaExtension, index: number, add: Emitter, layout: EdidLayout): void {
  const p = "cta" + index;
  const cta = layout.blocks[index + 1]?.cta ?? null;

  const head = add.scope(p + ".header", GROUP.cta, "CTA Header",
    "rev " + ext.revision, "string", cta?.header ?? null, "group");
  head.at(1, 1, p + ".revision", GROUP.cta, "CTA Revision", ext.revision, "number");
  head.at(3, 1, p + ".underscan", GROUP.cta, "Underscan Supported", ext.underscanSupported, "boolean");
  head.at(3, 1, p + ".basicAudio", GROUP.cta, "Basic Audio", ext.basicAudioSupported, "boolean");
  head.at(3, 1, p + ".ycbcr444", GROUP.cta, "YCbCr 4:4:4", ext.ycbcr444Supported, "boolean");
  head.at(3, 1, p + ".ycbcr422", GROUP.cta, "YCbCr 4:2:2", ext.ycbcr422Supported, "boolean");
  head.at(3, 1, p + ".nativeDtds", GROUP.cta, "Native DTD Count", ext.nativeDtdCount, "number");

  // The Y420 capability map indexes into the Video Data Block's SVD list, so
  // that sibling has to travel with the block being flattened.
  const videoBlock = ext.dataBlocks.find((b) => b.kind === "video");
  const svds = videoBlock && videoBlock.kind === "video" ? videoBlock.svds : [];

  // Count how many of each extended tag we have seen, so repeatable timing
  // blocks get distinct paths instead of collapsing onto one another.
  const seenExtTag = new Map<number, number>();
  ext.dataBlocks.forEach((block, i) => {
    let occurrence = 0;
    if (block.kind === "extended") {
      occurrence = seenExtTag.get(block.extendedTag) ?? 0;
      seenExtTag.set(block.extendedTag, occurrence + 1);
    }
    flattenCtaBlock(block, p, add, cta?.dataBlocks[i] ?? null, svds, occurrence);
  });

  ext.detailedTimings.forEach((d, i) => {
    const scope = add.scope(p + ".dtd" + i, GROUP.timing, "CTA DTD " + (i + 1),
      describeDtd(d), "string", cta?.detailedTimings[i] ?? null, "group");
    flattenDtd(d, p + ".dtd" + i, "CTA DTD " + (i + 1), scope);
  });
}

function flattenCtaBlock(
  block: CtaDataBlock, p: string, add: Emitter, region: CtaBlockRegion | null,
  svds: ShortVideoDescriptor[] = [], occurrence = 0,
): void {
  const ref = asVendorBlock(block);
  if (ref) {
    flattenVendorBlock(ref, p, add, region);
    return;
  }

  switch (block.kind) {
    case "video": {
      // Native SVDs are marked with * — the same convention the vendor tools use.
      const scope = add.scope(p + ".vdb", GROUP.cta, "Video Data Block",
        block.svds.length + " SVD(s)", "string", region?.whole ?? null, "group");
      const payload = region?.payload ?? null;
      const rel = payload && region ? payload.offset - region.whole.offset : 0;
      scope.at(rel, block.svds.length, p + ".svd", GROUP.cta, "Short Video Descriptors",
        block.svds.map((s) => describeVic(s.vic) + (s.native ? " *" : "")).join(" / "));
      scope.at(rel, block.svds.length, p + ".svd.vics", GROUP.cta, "SVD Codes (VIC)",
        block.svds.map((s) => (s.native ? s.vic + "*" : String(s.vic))).join(", "));
      scope(p + ".svd.count", GROUP.cta, "SVD Count", block.svds.length, "number");
      break;
    }
    case "audio": {
      const scope = add.scope(p + ".adb", GROUP.audio, "Audio Data Block",
        block.sads.length + " SAD(s)", "string", region?.whole ?? null, "group");
      const payload = region?.payload ?? null;
      const rel = payload && region ? payload.offset - region.whole.offset : 0;
      block.sads.forEach((s, i) => {
        const name = AUDIO_FORMAT[s.format] ?? "format " + s.format;
        const base = rel + i * 3;
        const sad = scope.scope(p + ".sad" + i, GROUP.audio, "Audio Descriptor " + (i + 1),
          name + ", " + s.maxChannels + " ch", "string",
          region ? { blockIndex: region.whole.blockIndex, offset: region.whole.offset + base, length: 3 } : null,
          "group");
        sad.at(0, 1, p + ".sad" + i + ".format", GROUP.audio, "Format", s.format, "enum");
        sad.at(0, 1, p + ".sad" + i + ".maxChannels", GROUP.audio, "Max Channels", s.maxChannels, "number");
        // CTA-861 sample-rate bitmask, bit0..6: 32 / 44.1 / 48 / 88.2 / 96 / 176.4 / 192 kHz.
        SAMPLE_RATE_KHZ.forEach((khz, bitIndex) => {
          sad.at(1, 1, p + ".sad" + i + ".rate" + khz.toString().replace(".", "_"), GROUP.audio,
            khz + " kHz", ((s.sampleRates >> bitIndex) & 1) === 1, "boolean");
        });
        sad.at(2, 1, p + ".sad" + i + ".byte3", GROUP.audio,
          "Byte 3 (format-dependent)", "0x" + s.byte3.toString(16).padStart(2, "0"), "hex");
      });
      scope(p + ".sad.count", GROUP.audio, "Audio Descriptor Count", block.sads.length, "number");
      break;
    }
    case "speaker-allocation": {
      const scope = add.scope(p + ".sab", GROUP.audio, "Speaker Allocation Block",
        "0x" + block.allocation.toString(16).padStart(2, "0"), "hex", region?.whole ?? null, "group");
      const payload = region?.payload ?? null;
      const rel = payload && region ? payload.offset - region.whole.offset : 0;
      scope.at(rel, 1, p + ".speakerAlloc", GROUP.audio, "Speaker Allocation",
        "0x" + block.allocation.toString(16).padStart(2, "0"), "hex");
      // Full 3-byte, 20-flag mask (CTA-861-D through -I). Byte n holds bits 8n..8n+7.
      for (const [byteIndex, bit, key, label] of SPEAKER_FLAGS) {
        const raw = block.raw[byteIndex] ?? 0;
        scope.at(rel + byteIndex, 1, p + ".speaker." + key, GROUP.audio, label,
          ((raw >> bit) & 1) === 1, "boolean");
      }
      break;
    }
    case "extended":
      flattenExtendedBlock(block.extendedTag, block.payload, p, add, region, svds, occurrence);
      break;
    case "unknown-cta":
      add.scope(p + ".tag" + block.tag, GROUP.cta, "CTA Block tag " + block.tag,
        bytesToHex(block.payload), "hex", region?.whole ?? null, "group");
      break;
  }
}

/**
 * Extended tags that may appear more than once in a single CTA extension —
 * each Type VII block carries exactly one descriptor, so a monitor advertising
 * three extra timings has three of them. Their paths carry the occurrence index
 * so the rows stay distinct; every other tag keeps its plain `ext<tag>` path.
 */
const REPEATABLE_EXT_TAGS = new Set([0x22, 0x23, 0x2a]);

function flattenExtendedBlock(
  tag: number, payload: Uint8Array, p: string, outer: Emitter, region: CtaBlockRegion | null,
  svds: ShortVideoDescriptor[] = [], occurrence = 0,
): void {
  const key = p + ".ext" + tag + (REPEATABLE_EXT_TAGS.has(tag) ? "_" + occurrence : "");
  // The container row owns the whole data block; leaf offsets below are
  // relative to it, so `rel` skips the tag byte and the extended-tag byte.
  const add = outer.scope(key + ".block", GROUP.cta, extendedTagLabel(tag),
    payload.length + " byte payload", "string", region?.whole ?? null, "group");
  switch (tag) {
    case CtaExtendedTag.Colorimetry: {
      // 10 flags across 2 bytes, bit positions from ColorimetryDataBlock.java's
      // getBit(): byte0 bits0-7 in enum order, byte1 bits6-7 for ICtCp/DCI-P3.
      add.at(2, 2, key, GROUP.cta, "Colorimetry", bytesToHex(payload), "hex");
      const b0 = payload[0] ?? 0, b1 = payload[1] ?? 0;
      COLORIMETRY_FLAGS.forEach(([byteOffset, bit, suffix, label]) => {
        const raw = byteOffset === 0 ? b0 : b1;
        add.at(2 + byteOffset, 1, key + "." + suffix, GROUP.cta, label, ((raw >> bit) & 1) === 1, "boolean");
      });
      break;
    }
    case CtaExtendedTag.HdrStaticMetadata: {
      const eotf = payload[0] ?? 0;
      add.at(2, 1, key + ".eotf", GROUP.hdr, "HDR EOTF", describeEotf(eotf));
      EOTF_FLAGS.forEach((label, bit) => {
        add.at(2, 1, key + ".eotf" + bit, GROUP.hdr, "EOTF: " + label, ((eotf >> bit) & 1) === 1, "boolean");
      });
      if (payload.length > 2) add.at(4, 1, key + ".maxLum", GROUP.hdr, "Max Luminance (code)", payload[2]!, "number");
      if (payload.length > 3) add.at(5, 1, key + ".avgLum", GROUP.hdr, "Max Frame-Avg Luminance (code)", payload[3]!, "number");
      if (payload.length > 4) add.at(6, 1, key + ".minLum", GROUP.hdr, "Min Luminance (code)", payload[4]!, "number");
      break;
    }
    case CtaExtendedTag.HdrDynamicMetadata:
      add.at(2, payload.length, key, GROUP.hdr, "HDR Dynamic Metadata", bytesToHex(payload), "hex");
      break;
    case CtaExtendedTag.VideoCapability: {
      // Bit layout from VideoCapabilityDataBlock.java: QY(7) QS(6) S_PT(5:4) S_IT(3:2) S_CE(1:0).
      const v = payload[0] ?? 0;
      add.at(2, 1, key, GROUP.cta, "Video Capability", "0x" + v.toString(16).padStart(2, "0"), "hex");
      add.at(2, 1, key + ".qy", GROUP.cta, "QY: Selectable Quantization (RGB)", ((v >> 7) & 1) === 1, "boolean");
      add.at(2, 1, key + ".qs", GROUP.cta, "QS: Selectable Quantization (YCC)", ((v >> 6) & 1) === 1, "boolean");
      add.at(2, 1, key + ".spt", GROUP.cta, "S_PT: Progressive Scan Info", (v >> 4) & 3, "enum");
      add.at(2, 1, key + ".sit", GROUP.cta, "S_IT: Interlaced Scan Info", (v >> 2) & 3, "enum");
      add.at(2, 1, key + ".sce", GROUP.cta, "S_CE: CE Scan Info", v & 3, "enum");
      break;
    }
    case CtaExtendedTag.Ycbcr420Video:
      add.at(2, payload.length, key, GROUP.cta, "YCbCr 4:2:0 Video",
        Array.from(payload).map((v) => describeVic(v)).join(" / "));
      break;
    case 0x22:   // Type VII Video Timing, carried in CTA
      if (payload.length > 1) {
        add.at(2, 1, key + ".t7m", GROUP.timing, "Type VII Descriptor Size (extra bytes)",
          bits(payload[0]!, 6, 4), "number");
        // The descriptor starts after the options byte; leaves are relative to it.
        flattenTypeVII(payload.subarray(1), payload[0]!, key,
          add.scope(key + ".t7block", GROUP.timing, "Type VII Timing",
            "detailed timing", "string",
            region ? { blockIndex: region.whole.blockIndex, offset: region.whole.offset + 3,
                       length: Math.max(0, region.whole.length - 3) } : null, "group"));
      }
      break;
    case 0x2a:   // Type X Video Timing, carried in CTA
      if (payload.length > 1) {
        add.at(2, 1, key + ".txm", GROUP.timing, "Type X Descriptor Size (extra bytes)",
          bits(payload[0]!, 6, 4), "number");
        const txAnchor: Region | null = region
          ? { blockIndex: region.whole.blockIndex, offset: region.whole.offset + 3,
              length: Math.max(0, region.whole.length - 3) }
          : null;
        flattenTypeX(payload.subarray(1), payload[0]!, key,
          add.scope(key + ".txblock", GROUP.timing, "Type X Timings",
            payload.length - 1 + " payload bytes", "string", txAnchor, "group"),
          txAnchor);
      }
      break;
    case 0x23:   // Type VIII Enumerated Timing Codes, carried in CTA
      if (payload.length > 1) {
        add.at(2, 1, key + ".t8opt", GROUP.timing, "Type VIII Options (raw)", payload[0]!, "number");
        flattenTypeVIII(payload.subarray(1), payload[0]!, "cta", key,
          add.scope(key + ".t8block", GROUP.timing, "Type VIII Timing Codes",
            payload.length - 1 + " payload bytes", "string",
            region ? { blockIndex: region.whole.blockIndex, offset: region.whole.offset + 3,
                       length: Math.max(0, region.whole.length - 3) } : null, "group"));
      }
      break;
    case CtaExtendedTag.HdmiForumEeodb:
      // The real extension block count when it exceeds what base byte 126 can say.
      add.at(2, 1, key, GROUP.cta, "HF-EEODB Extension Block Count", payload[0] ?? 0, "number");
      break;
    case CtaExtendedTag.Ycbcr420CapabilityMap: {
      add.at(2, payload.length, key, GROUP.cta, "YCbCr 4:2:0 Capability Map", bytesToHex(payload), "hex");
      // Bit N corresponds to the Nth SVD of the sibling Video Data Block. An
      // empty bitmap is not "none" — the spec defines it as "every SVD", which
      // is a classic decoder trap, so it is spelled out rather than inferred.
      if (payload.length === 0) {
        add(key + ".all", GROUP.cta, "YCbCr 4:2:0 · All SVDs", true, "boolean");
        break;
      }
      svds.forEach((svd, i) => {
        const byteIndex = i >> 3;
        if (byteIndex >= payload.length) return;
        add.at(2 + byteIndex, 1, key + ".svd" + i, GROUP.cta,
          "YCbCr 4:2:0 · " + describeVic(svd.vic),
          ((payload[byteIndex]! >> (i & 7)) & 1) === 1, "boolean");
      });
      break;
    }
    default:
      add.at(2, payload.length, key, GROUP.cta, "Extended tag " + tag, bytesToHex(payload), "hex");
  }
}

function flattenVendorBlock(
  ref: VendorBlockRef, p: string, outer: Emitter, region: CtaBlockRegion | null,
): void {
  const view = parseVsdb(ref);
  const name = OUI_NAMES[ref.oui] ?? "Vendor " + ouiToString(ref.oui);
  const key = p + ".vsdb." + ouiToString(ref.oui);
  // Anchor to the vendor payload, so every leaf offset below matches the
  // indices the vendor parser itself uses (payload[0] is the first byte).
  const add = outer.scope(key, name, name, ouiToString(ref.oui), "string",
    region?.vendorPayload ?? null, "group");

  switch (view.type) {
    case "hdmi14b": {
      const d = view.data;
      const g = "HDMI 1.4b VSDB";
      add.at(0, 2, key + ".phyAddr", g, "Source Physical Address", d.physicalAddress.join("."));
      add.at(3, 1, key + ".maxTmds", g, "Max TMDS Clock (MHz)", d.maxTmdsClockMhz, "number");
      add.at(2, 1, key + ".dc30", g, "Deep Color 30-bit", d.dc30bit, "boolean");
      add.at(2, 1, key + ".dc36", g, "Deep Color 36-bit", d.dc36bit, "boolean");
      add.at(2, 1, key + ".dc48", g, "Deep Color 48-bit", d.dc48bit, "boolean");
      add.at(2, 1, key + ".dcY444", g, "Deep Color YCbCr 4:4:4", d.dcY444, "boolean");
      add.at(2, 1, key + ".ai", g, "Supports_AI", d.supportsAi, "boolean");
      add.at(2, 1, key + ".dviDual", g, "DVI Dual-Link", d.dviDualLink, "boolean");
      if (d.flags) {
        add.at(4, 1, key + ".cncGame", g, "Content Type: Game", d.flags.supportsGame, "boolean");
        add.at(4, 1, key + ".cncCinema", g, "Content Type: Cinema", d.flags.supportsCinema, "boolean");
        add.at(4, 1, key + ".cncPhoto", g, "Content Type: Photo", d.flags.supportsPhoto, "boolean");
        add.at(4, 1, key + ".cncGraphics", g, "Content Type: Graphics", d.flags.supportsGraphics, "boolean");
      }
      if (d.latency) {
        add.at(5, 1, key + ".videoLatency", g, "Video Latency (code)", d.latency.video, "number");
        add.at(6, 1, key + ".audioLatency", g, "Audio Latency (code)", d.latency.audio, "number");
      }
      if (d.interlacedLatency) {
        add.at(7, 1, key + ".iVideoLatency", g, "Interlaced Video Latency (code)", d.interlacedLatency.video, "number");
        add.at(8, 1, key + ".iAudioLatency", g, "Interlaced Audio Latency (code)", d.interlacedLatency.audio, "number");
      }
      if (d.video) {
        const v = d.video;
        // The one genuinely variable offset in this block: buildHdmi14bVsdb
        // emits the latency pairs first, so the video section starts after
        // whichever of them are present (hdmi14b.ts:240-252).
        const videoAt = 5 + (d.latency ? 2 : 0) + (d.interlacedLatency ? 2 : 0);
        const vicsAt = videoAt + 2;
        if (v.hdmiVics.length) {
          add.at(vicsAt, v.hdmiVics.length, key + ".hdmiVics", g, "4K x 2K Support (HDMI VIC)",
            v.hdmiVics.map((x) => HDMI_VIC_LABELS[x] ?? "HDMI VIC " + x).join(" / "));
        }
        add.at(videoAt, 1, key + ".imageSize", g, "Image Size Meaning", v.imageSize, "enum");
        add.at(videoAt, 1, key + ".3dPresent", g, "3D Present", v.threeDPresent, "boolean");
        if (v.threeDPresent) {
          add.at(videoAt, 1, key + ".3dMulti", g, "3D Multi Present", v.threeDMultiPresent, "enum");
          let at = vicsAt + v.hdmiVics.length;
          if (v.structure3D !== null) {
            add.at(at, 2, key + ".3dStructure", g, "3D Structure Mask",
              "0x" + v.structure3D.toString(16).padStart(4, "0"), "hex");
            at += 2;
          }
          if (v.mask3D !== null) at += 2;
          for (const [n, e] of v.entries3D.entries()) {
            const width = entry3DByteLength(e.structure);
            add.at(at, width, key + ".3dEntry" + n, g, "3D Entry " + (n + 1),
              "SVD #" + (e.vicIndex + 1) + ": " + (THREE_D_STRUCTURES[e.structure] ?? "structure " + e.structure));
            at += width;
          }
        }
      }
      break;
    }
    case "hdmi-forum": {
      const d = view.data;
      const g = "HDMI Forum VSDB (2.1)";
      add.at(0, 1, key + ".version", g, "Version", d.version, "number");
      add.at(1, 1, key + ".maxTmds", g, "Max TMDS Character Rate (MHz)", d.maxTmdsClockMhz, "number");
      add.at(3, 1, key + ".maxFrl", g, "Max FRL Rate", d.maxFrlRate, "enum");
      add.at(2, 1, key + ".scdc", g, "SCDC Present", d.scdcPresent, "boolean");
      add.at(2, 1, key + ".rrCapable", g, "RR Capable", d.rrCapable, "boolean");
      add.at(2, 1, key + ".cableStatus", g, "Cable Status", d.cableStatus, "boolean");
      add.at(2, 1, key + ".ccbpci", g, "CCBPCI", d.ccbpci, "boolean");
      add.at(2, 1, key + ".lte340Scramble", g, "LTE 340MHz Scramble", d.lte340MhzScramble, "boolean");
      add.at(2, 1, key + ".independentView", g, "Independent View", d.independentView, "boolean");
      add.at(2, 1, key + ".dualView", g, "Dual View", d.dualView, "boolean");
      add.at(2, 1, key + ".osdDisparity3d", g, "3D OSD Disparity", d.osdDisparity3d, "boolean");
      add.at(3, 1, key + ".uhdVic", g, "UHD VIC", d.uhdVic, "boolean");
      add.at(3, 1, key + ".dc30_420", g, "DC 30-bit 4:2:0", d.dc30bit420, "boolean");
      add.at(3, 1, key + ".dc36_420", g, "DC 36-bit 4:2:0", d.dc36bit420, "boolean");
      add.at(3, 1, key + ".dc48_420", g, "DC 48-bit 4:2:0", d.dc48bit420, "boolean");
      if (d.ext) {
        add.at(4, 1, key + ".allm", g, "ALLM", d.ext.allm, "boolean");
        add.at(4, 1, key + ".fva", g, "FVA", d.ext.fva, "boolean");
        add.at(4, 1, key + ".qms", g, "QMS", d.ext.qms, "boolean");
        add.at(4, 1, key + ".cinemaVrr", g, "Cinema VRR", d.ext.cinemaVrr, "boolean");
        add.at(4, 1, key + ".negMvrr", g, "NEG_MVRR", d.ext.negMvrr, "boolean");
        add.at(4, 1, key + ".mdelta", g, "M-delta", d.ext.mdelta, "boolean");
        add.at(4, 1, key + ".fapaStart", g, "FAPA Start Location", d.ext.fapaStartLocation, "boolean");
        add.at(4, 1, key + ".fapaEndExt", g, "FAPA End Extended", d.ext.fapaEndExtended, "boolean");
      }
      if (d.vrr) {
        add.at(5, 1, key + ".vrrMin", g, "VRR Min (Hz)", d.vrr.min, "number");
        add.at(5, 2, key + ".vrrMax", g, "VRR Max (Hz)", d.vrr.max, "number");
      }
      if (d.dsc) {
        add.at(7, 1, key + ".dsc1p2", g, "DSC 1.2a", d.dsc.dsc1p2, "boolean");
        add.at(7, 1, key + ".dscNative420", g, "DSC Native 4:2:0", d.dsc.dscNative420, "boolean");
        add.at(8, 1, key + ".dscMaxFrl", g, "DSC Max FRL Rate", d.dsc.maxFrlRate, "enum");
        add.at(8, 1, key + ".dscMaxSlices", g, "DSC Max Slices", d.dsc.maxSlices, "enum");
        add.at(7, 1, key + ".dsc10bpc", g, "DSC 10 bpc", d.dsc.dsc10bpc, "boolean");
        add.at(7, 1, key + ".dsc12bpc", g, "DSC 12 bpc", d.dsc.dsc12bpc, "boolean");
        add.at(7, 1, key + ".dsc16bpc", g, "DSC 16 bpc", d.dsc.dsc16bpc, "boolean");
        add.at(7, 1, key + ".dscAllBpp", g, "DSC All bpp", d.dsc.dscAllBpp, "boolean");
        add.at(7, 1, key + ".qmsTfrMin", g, "QMS TFR Min", d.dsc.qmsTfrMin, "boolean");
        add.at(7, 1, key + ".qmsTfrMax", g, "QMS TFR Max", d.dsc.qmsTfrMax, "boolean");
        add.at(9, 1, key + ".dscChunk", g, "DSC Total Chunk kBytes", d.dsc.totalChunkKBytes, "number");
      }
      break;
    }
    case "dolby-vision": {
      const g = "Dolby Vision";
      add.at(0, 1, key + ".version", g, "DV Version", view.data.version, "number");
      add.at(0, view.data.payload.length, key + ".variant", g, "DV Variant", view.data.variant, "enum");
      add.at(0, view.data.payload.length, key + ".payload", g, "DV Payload", bytesToHex(view.data.payload), "hex");
      // Per-variant fields. The coded values carry their physical meaning in the
      // label, the way the tool being replaced pairs a code spinner with a
      // decoded read-out.
      for (const fd of dolbyVisionFields(view.data)) {
        add.at(fd.offset, fd.length, key + ".dv." + fd.key, g,
          fd.decoded ? fd.label + " = " + fd.decoded : fd.label, fd.value, fd.kind);
      }
      break;
    }
    case "hdr10plus": {
      const d = view.data;
      const g = "HDR10+";
      add.at(0, 1, key + ".appVersion", g, "HDR10+ Application Version", d.applicationVersion, "number");
      add.at(0, 1, key + ".peakIndex", g, "HDR10+ Peak Luminance Index", d.peakLuminanceIndex, "number");
      add.at(0, 1, key + ".ffPeakIndex", g, "HDR10+ Full-Frame Peak Luminance Index", d.fullFramePeakLuminanceIndex, "number");
      break;
    }
    case "amd-freesync": {
      const d = view.data;
      const g = "AMD FreeSync";
      add.at(0, 1, key + ".version", g, "FreeSync Version", d.version, "number");
      add.at(1, 1, key + ".supported", g, "FreeSync Supported", d.freesyncSupported, "boolean");
      add.at(1, 1, key + ".native", g, "Native", d.native, "boolean");
      add.at(1, 1, key + ".localDimming", g, "Local Dimming Disable", d.localDimmingDisable, "boolean");
      add.at(2, 1, key + ".minHz", g, "FreeSync Min Refresh (Hz)", d.minRefreshHz, "number");
      add.at(3, 1, key + ".maxHz", g, "FreeSync Max Refresh (Hz)", d.maxRefreshHz, "number");
      add.at(4, 1, key + ".mccs", g, "MCCS VCP Support", d.mccsVcpSupport, "number");
      // Only emit the bytes this block actually carries. `buildAmdFreesyncVsdb`
      // truncates to `presentBytes`, so a row for a byte beyond the end would
      // accept an edit and then lose it on save — the block length is set by the
      // FreeSync version and growing it would be inventing capability data.
      const has = (byteIndex: number) => d.presentBytes > byteIndex;
      if (has(5)) add.at(5, 1, key + ".gammaBits", g, "Gamma Bits", d.gammaBits, "number");
      if (has(6)) {
        add.at(6, 1, key + ".maxLum1", g, "Max Luminance 1 (code)", d.maxLuminance1, "number");
        if (has(7)) {
          add.at(6, 2, key + ".minLum1", g, "Min Luminance 1 (cd/m2)",
            round2(amdMinLuminance(d.minLuminance1Raw, d.maxLuminance1)), "number");
        }
      }
      if (has(7)) add.at(7, 1, key + ".minLum1Code", g, "Min Luminance 1 (code)", d.minLuminance1Raw, "number");
      if (has(8)) add.at(8, 1, key + ".maxLum2", g, "Max Luminance 2 (code)", d.maxLuminance2, "number");
      if (has(9)) add.at(9, 1, key + ".minLum2Code", g, "Min Luminance 2 (code)", d.minLuminance2Raw, "number");
      if (has(11) && d.maxLsbFreesyncRefreshHz) {
        add.at(10, 2, key + ".lsbHz", g, "Max LSB FreeSync Refresh (Hz)", d.maxLsbFreesyncRefreshHz, "number");
      }
      break;
    }
    case "generic":
      add.at(0, view.data.payload.length, key + ".payload", name, name + " Payload", bytesToHex(view.data.payload), "hex");
      break;
  }
}

function flattenDisplayId(
  ext: DisplayIdExtension, index: number, add: Emitter, layout: EdidLayout,
): void {
  const p = "did" + index;
  const version = ext.version + "." + ext.revision;
  add.at(1, 1, p + ".version", GROUP.displayid, "DisplayID Version", version);
  add.at(1, 1, p + ".versionMajor", GROUP.displayid, "DisplayID Version (major)", ext.version, "number");
  add.at(1, 1, p + ".versionMinor", GROUP.displayid, "DisplayID Revision (minor)", ext.revision, "number");
  // Byte 3 is "product type" in DisplayID 1.x and "primary use case" in 2.0.
  add.at(3, 1, p + ".useCase", GROUP.displayid,
    ext.version >= 2 ? "Primary Use Case" : "Product Type", ext.productType, "number");
  add(p + ".blockCount", GROUP.displayid, "Data Block Count", ext.dataBlocks.length, "number");

  const did = layout.blocks[index + 1]?.displayid ?? null;
  ext.dataBlocks.forEach((db, i) => {
    flattenDidBlock(db, p + ".db" + i, i, add, did?.dataBlocks[i] ?? null);
  });
}

function flattenDidBlock(
  db: DisplayIdDataBlock, key: string, i: number, outer: Emitter, region: DidBlockRegion | null,
): void {
  const label = didTagLabel(db.tag);
  const g = GROUP.displayid;
  // Anchor to the payload so leaf offsets match the indices the DisplayID
  // parsers use (payload[0] is the first byte after tag/revision/length).
  const add = outer.scope(key, g, "Block " + (i + 1) + ": " + label,
    db.payload.length + " byte payload", "string", region?.payload ?? null, "group");
  add.at(-3, 3, key + ".tag", g, "Block " + (i + 1) + ": " + label,
    "0x" + db.tag.toString(16).padStart(2, "0") + " rev " + (db.revision & 0x07), "enum");

  try {
    switch (db.tag) {
      case DidTag.DisplayParamsV2: {
        const d = parseDisplayParamsV2(db.payload);
        // Bit 4 of the block's flags byte selects mm vs 0.1 mm units.
        const mult = ((db.revision >> 4) & 1) === 1;
        add(key + ".hSize", g, label + " · H Image Size (mm)", round2(imageSizeMm(d.horizontalImageSizeRaw, mult)), "number");
        add(key + ".vSize", g, label + " · V Image Size (mm)", round2(imageSizeMm(d.verticalImageSizeRaw, mult)), "number");
        add(key + ".hPixels", g, label + " · H Pixel Count", d.horizontalPixelCount, "number");
        add(key + ".vPixels", g, label + " · V Pixel Count", d.verticalPixelCount, "number");
        // Enumerations carry the raw code, never the label — the writer stores
        // codes, and a label leaking into `value` has broken round-trips twice.
        // `describeInput` turns each of these into a labelled dropdown.
        add(key + ".scan", g, label + " · Scan Orientation ("
          + (SCAN_ORIENTATION[d.scanOrientation] ?? "?") + ")", d.scanOrientation, "enum");
        add(key + ".lumInfo", g, label + " · Luminance Info ("
          + (LUMINANCE_INFO[d.luminanceInfo] ?? "?") + ")", d.luminanceInfo, "enum");
        add(key + ".colorSpace", g, label + " · Color Space is CIE 1976", d.colorSpaceCie1976, "boolean");
        add(key + ".speaker", g, label + " · Audio Speaker Not Integrated", d.audioSpeakerNotIntegrated, "boolean");
        for (const [name, coord] of [["primary1", d.primary1], ["primary2", d.primary2],
                                     ["primary3", d.primary3], ["white", d.white]] as const) {
          const pretty = name === "white" ? "White" : "Primary " + name.slice(-1);
          add(key + "." + name, g, label + " · " + pretty + " (x, y)", cie(coord));
          add(key + "." + name + "X", g, label + " · " + pretty + " x (code)", coord.x, "number");
          add(key + "." + name + "Y", g, label + " · " + pretty + " y (code)", coord.y, "number");
        }
        add(key + ".maxLum", g, label + " · Max Luminance (cd/m2)", round2(halfToFloat(d.maxLuminanceFull)), "number");
        add(key + ".maxLum10", g, label + " · Max Luminance 10% (cd/m2)", round2(halfToFloat(d.maxLuminance10Percent)), "number");
        add(key + ".minLum", g, label + " · Min Luminance (cd/m2)", round2(halfToFloat(d.minLuminance)), "number");
        add(key + ".colorDepth", g, label + " · Native Color Depth ("
          + (NATIVE_COLOR_DEPTH[d.nativeColorDepth] ?? "?") + ")", d.nativeColorDepth, "enum");
        add(key + ".tech", g, label + " · Device Technology ("
          + (DISPLAY_DEVICE_TECH[d.displayDeviceTechnology] ?? "?") + ")", d.displayDeviceTechnology, "enum");
        add(key + ".gamma", g, label + " · Gamma",
          d.gammaRaw === 0xff ? "not defined" : round2((d.gammaRaw + 100) / 100), "number");
        return;
      }
      case DidTag.AdaptiveSync: {
        const { descriptors } = parseAdaptiveSync(db.payload);
        descriptors.forEach((a, n) => {
          const dk = key + ".as" + n;
          const pre = label + " " + (n + 1) + " · ";
          add(dk + ".range", g, pre + "Range", a.nativePanelRange ? "native panel" : "non-native panel", "enum");
          add(dk + ".modes", g, pre + "Supported Modes ("
            + (ADAPTIVE_SYNC_MODES[a.supportedModes] ?? "?") + ")", a.supportedModes, "enum");
          add(dk + ".seamless", g, pre + "Seamless Transition", a.seamlessTransition, "boolean");
          add(dk + ".minHz", g, pre + "Min Refresh Rate (Hz)", a.minRefreshRateHz, "number");
          add(dk + ".maxHz", g, pre + "Max Refresh Rate (Hz)", a.maxRefreshRateHz, "number");
          add(dk + ".sfdInc", g, pre + "Max Single Frame Increase (%)",
            round2(singleFrameDeltaPercent(a.maxSingleFrameIncreaseCode)), "number");
          add(dk + ".sfdIncCode", g, pre + "Max Single Frame Increase (code)",
            a.maxSingleFrameIncreaseCode, "number");
          add(dk + ".sfdDec", g, pre + "Max Single Frame Decrease (%)",
            round2(singleFrameDeltaPercent(a.maxSingleFrameDecreaseCode)), "number");
          add(dk + ".sfdDecCode", g, pre + "Max Single Frame Decrease (code)",
            a.maxSingleFrameDecreaseCode, "number");
        });
        return;
      }
      case DidTag.ContainerId:
        add(key + ".uuid", g, label, formatContainerId(db.payload));
        return;
      case DidTag.TiledTopologyV1:
      case DidTag.TiledTopologyV2: {
        const t = parseTiledTopology(db.payload);
        add(key + ".grid", g, label + " · Grid (H x V)", t.horizontalTileCount + " x " + t.verticalTileCount);
        add(key + ".loc", g, label + " · This Tile (H, V)", t.horizontalLocation + ", " + t.verticalLocation);
        add(key + ".size", g, label + " · Tile Size (px)", t.horizontalSize + " x " + t.verticalSize);
        add(key + ".bezel", g, label + " · Bezel (T/B/R/L)",
          [t.bezel.top, t.bezel.bottom, t.bezel.right, t.bezel.left].join("/"));
        return;
      }
      case DidTag.ProductSerialNumber:
      case DidTag.AsciiString:
        add(key + ".text", g, label, asciiOf(db.payload));
        return;
      case DidTag.TimingVII:
        flattenTypeVII(db.payload, db.revision, key, add);
        return;
      case DidTag.TimingX:
        flattenTypeX(db.payload, db.revision, key, add, region?.payload ?? null);
        return;
      case DidTag.TimingVIII:
        // In this carrier the DisplayID revision byte is the options byte.
        flattenTypeVIII(db.payload, db.revision, "displayid", key, add);
        return;
      case DidTag.DynamicRangeLimits: {
        const d = parseDynamicRangeLimits(db.payload);
        add.at(0, 3, key + ".minClock", g, label + " · Min Pixel Clock (kHz)", d.minPixelClockKhz, "number");
        add.at(3, 3, key + ".maxClock", g, label + " · Max Pixel Clock (kHz)", d.maxPixelClockKhz, "number");
        add.at(6, 1, key + ".minRefresh", g, label + " · Min Refresh Rate (Hz)", d.minRefreshRateHz, "number");
        add.at(7, 1, key + ".maxRefresh", g, label + " · Max Refresh Rate (Hz)", d.maxRefreshRateHz, "number");
        add.at(8, 1, key + ".seamless", g, label + " · Seamless Dynamic Video", d.seamlessDynamicVideo, "boolean");
        return;
      }
      case DidTag.TimingI: {
        const t = parseTypeITiming(db.payload);
        add.at(0, 3, key + ".clock", g, label + " · Pixel Clock (MHz)", t.pixelClockMhz, "number");
        add.at(3, 1, key + ".aspect", g, label + " · Aspect Ratio", t.aspectRatio, "enum");
        add.at(3, 1, key + ".interlaced", g, label + " · Interlaced", t.interlaced, "boolean");
        add.at(3, 1, key + ".preferred", g, label + " · Preferred", t.preferred, "boolean");
        add.at(3, 1, key + ".support3d", g, label + " · 3D Support", t.support3d, "enum");
        add.at(4, 2, key + ".hActive", g, label + " · H Active (px)", t.hActive, "number");
        add.at(6, 2, key + ".hBlank", g, label + " · H Blank (px)", t.hBlank, "number");
        add.at(8, 2, key + ".hSyncOffset", g, label + " · H Sync Offset (px)", t.hSyncOffset, "number");
        add.at(8, 2, key + ".hSyncPositive", g, label + " · H Sync Positive", t.hSyncPositive, "boolean");
        add.at(10, 2, key + ".hSyncWidth", g, label + " · H Sync Width (px)", t.hSyncWidth, "number");
        add.at(12, 2, key + ".vActive", g, label + " · V Active (px)", t.vActive, "number");
        add.at(14, 2, key + ".vBlank", g, label + " · V Blank (px)", t.vBlank, "number");
        add.at(16, 2, key + ".vSyncOffset", g, label + " · V Sync Offset (px)", t.vSyncOffset, "number");
        add.at(16, 2, key + ".vSyncPositive", g, label + " · V Sync Positive", t.vSyncPositive, "boolean");
        add.at(18, 2, key + ".vSyncWidth", g, label + " · V Sync Width (px)", t.vSyncWidth, "number");
        return;
      }
    }
  } catch {
    // Fall through to the raw view when a block is shorter than its spec length.
  }

  if (db.payload.length > 0) {
    add.at(0, db.payload.length, key + ".payload", g, label + " · Payload", bytesToHex(db.payload), "hex");
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const cie = (c: ColorCoord12) => coordToCie(c.x).toFixed(4) + ", " + coordToCie(c.y).toFixed(4);

function asciiOf(p: Uint8Array): string {
  let s = "";
  for (const b of p) if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
  return s.trim();
}

// ------------------------------------------------------------------- tables

/** HDMI 1.4b 4K x 2K modes; these are HDMI VICs, not CTA VICs. */
const HDMI_VIC_LABELS: Record<number, string> = {
  1: "3840x2160p @ 30 Hz", 2: "3840x2160p @ 25 Hz",
  3: "3840x2160p @ 24 Hz", 4: "4096x2160p @ 24 Hz",
};

const DIGITAL_INTERFACE: Record<number, string> = {
  0: "undefined", 1: "DVI", 2: "HDMI-a", 3: "HDMI-b", 4: "MDDI", 5: "DisplayPort",
};

const SAMPLE_RATE_KHZ = [32, 44.1, 48, 88.2, 96, 176.4, 192];

/**
 * Established timings — [path key, label, DMT-ish id, byte index 0-2, bit].
 * Bit assignments from EstTypeI / EstTypeII / EstManf in the decompiled JAR.
 * Byte 2 bits 6:0 are manufacturer-reserved and deliberately not exposed.
 */
export const ESTABLISHED_TIMINGS: [string, string, string, number, number][] = [
  ["t720x400_70", "720 x 400 @ 70Hz", "IBM0770H", 0, 7],
  ["t720x400_88", "720 x 400 @ 88Hz", "XGA2", 0, 6],
  ["t640x480_60", "640 x 480 @ 60Hz", "DMT0660", 0, 5],
  ["t640x480_67", "640 x 480 @ 67Hz", "APP0667", 0, 4],
  ["t640x480_72", "640 x 480 @ 72Hz", "DMT0672", 0, 3],
  ["t640x480_75", "640 x 480 @ 75Hz", "DMT0675", 0, 2],
  ["t800x600_56", "800 x 600 @ 56Hz", "DMT0856", 0, 1],
  ["t800x600_60", "800 x 600 @ 60Hz", "DMT0860", 0, 0],
  ["t800x600_72", "800 x 600 @ 72Hz", "DMT0872", 1, 7],
  ["t800x600_75", "800 x 600 @ 75Hz", "DMT0875", 1, 6],
  ["t832x624_75", "832 x 624 @ 75Hz", "APP0875", 1, 5],
  ["t1024x768_87i", "1024 x 768 @ 87Hz (Int)", "DMT1043", 1, 4],
  ["t1024x768_60", "1024 x 768 @ 60Hz", "DMT1060", 1, 3],
  ["t1024x768_70", "1024 x 768 @ 70Hz", "DMT1070", 1, 2],
  ["t1024x768_75", "1024 x 768 @ 75Hz", "DMT1075", 1, 1],
  ["t1280x1024_75", "1280 x 1024 @ 75Hz", "DMT1275G", 1, 0],
  ["t1152x870_75", "1152 x 870 @ 75Hz", "APP1175", 2, 7],
];

/** Standard-timing aspect ratio codes (byte 39+2i bits 7:6). */
export const STD_ASPECT_LABEL = ["16:10", "4:3", "5:4", "16:9"];

/** [byteIndex, bitIndex, path key, label], from SpeakerAllocation.Type (aud/SpeakerAllocation.java). */
const SPEAKER_FLAGS: [number, number, string, string][] = [
  [0, 0, "flFr", "Front Left/Right (FL/FR)"],
  [0, 1, "lfe1", "Low Frequency Effects 1 (LFE1)"],
  [0, 2, "fc", "Front Center (FC)"],
  [0, 3, "blBr", "Back Left/Right (BL/BR)"],
  [0, 4, "bc", "Back Center (BC)"],
  [0, 5, "flcFrc", "Front Left/Right Center (FLC/FRC)"],
  [0, 6, "rlcRrc", "Rear Left/Right Center (RLC/RRC)"],
  [0, 7, "flwFrw", "Front Left/Right Wide (FLW/FRW)"],
  [1, 0, "tflTfr", "Top Front Left/Right (TpFL/TpFR)"],
  [1, 1, "tc", "Top Center (TpC)"],
  [1, 2, "tfc", "Top Front Center (TpFC)"],
  [1, 3, "lsRs", "Left/Right Surround (LS/RS)"],
  [1, 4, "lfe2", "Low Frequency Effects 2 (LFE2)"],
  [1, 5, "tbc", "Top Back Center (TpBC)"],
  [1, 6, "slSr", "Side Left/Right (SiL/SiR)"],
  [1, 7, "tslTsr", "Top Side Left/Right (TpSiL/TpSiR)"],
  [2, 0, "tblTbr", "Top Back Left/Right (TpBL/TpBR)"],
  [2, 1, "bfc", "Bottom Front Center (BtFC)"],
  [2, 2, "bflBfr", "Bottom Front Left/Right (BtFL/BtFR)"],
  [2, 3, "tlsTrs", "Top Left/Right Surround (TpLS/TpRS)"],
];

/** [byteOffset within the 2-byte payload, bit, path suffix, label] — ColorimetryDataBlock.java getBit(). */
const COLORIMETRY_FLAGS: [number, number, string, string][] = [
  [0, 0, "xvycc601", "xvYCC601"], [0, 1, "xvycc709", "xvYCC709"], [0, 2, "sycc601", "sYCC601"],
  [0, 3, "opycc601", "opYCC601"], [0, 4, "oprgb", "opRGB"],
  [0, 5, "bt2020cycc", "BT.2020 cYCC"], [0, 6, "bt2020ycc", "BT.2020 YCC"], [0, 7, "bt2020rgb", "BT.2020 RGB"],
  [1, 6, "ictcp", "ICtCp"], [1, 7, "dcip3", "DCI-P3"],
];

const EOTF_FLAGS = ["SDR", "HDR (traditional)", "SMPTE ST 2084 (PQ)", "HLG"];

/** S_PT / S_IT / S_CE share this 2-bit meaning in the Video Capability Data Block. */
export const SCAN_INFO = ["No data", "Always overscanned", "Always underscanned", "Both"];

export const AUDIO_FORMAT: Record<number, string> = {
  1: "LPCM", 2: "AC-3", 3: "MPEG-1", 4: "MP3", 5: "MPEG-2", 6: "AAC LC", 7: "DTS",
  8: "ATRAC", 9: "DSD", 10: "E-AC-3", 11: "DTS-HD", 12: "MLP", 13: "DST", 14: "WMA Pro",
  15: "extended",
};

function describeEotf(mask: number): string {
  const names = ["SDR", "HDR (traditional)", "SMPTE ST 2084 (PQ)", "HLG"];
  const on = names.filter((_, i) => (mask >> i) & 1);
  return on.length ? on.join(", ") : "none";
}
