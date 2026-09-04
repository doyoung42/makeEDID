import type {
  Edid, ExtensionBlock, CtaExtension, DisplayIdExtension,
  CtaDataBlock, Descriptor, DetailedTimingDescriptor,
} from "./types.js";
import { encodeEdid } from "./codec.js";
import { CtaExtendedTag } from "./cta.js";
import { asVendorBlock, ouiToString } from "./vsdb/index.js";
import { DidTag } from "./displayid2.js";
import { HDMI_14B_OUI } from "./vsdb/hdmi14b.js";
import { HDMI_FORUM_OUI } from "./vsdb/hdmiForum.js";
import { HDR10PLUS_OUI } from "./vsdb/hdr10plus.js";
import { DOLBY_VISION_OUI } from "./vsdb/dolbyVision.js";
import { AMD_FREESYNC_OUI } from "./vsdb/amdFreesync.js";
import { DEFAULT_TIMING } from "./template.js";

/**
 * Structural edits — adding and removing blocks, not changing field values.
 *
 * `applyField` can only change a field that already exists. Building a spec
 * from scratch needs the other half: a new file starts as a base block with no
 * extensions, so without this module 191 of the 255 field shapes a real
 * production EDID carries are simply unreachable.
 *
 * The contract matches `applyField`, so the UI can treat both the same way:
 *
 *   `false`   — this operation does not apply to this target
 *   throw     — it applies, but the argument or the byte budget is wrong
 *
 * Every operation is **validated by the encoder**. The mutation is applied,
 * `encodeEdid` is run, and if it throws the mutation is rolled back and the
 * error is re-thrown with context. That keeps the byte-budget rules in exactly
 * one place (`encodeCtaExtension` / `encodeDisplayIdExtension` already refuse to
 * overflow a 128-byte block) instead of duplicating them here, where they could
 * drift.
 */

// ------------------------------------------------------------- validation

/**
 * Apply `mutate`, then prove the model still encodes. On failure `undo` runs and
 * the encoder's own message is surfaced — it names the block that overflowed.
 */
function guarded(edid: Edid, what: string, mutate: () => void, undo: () => void): boolean {
  mutate();
  try {
    encodeEdid(edid);
  } catch (e) {
    undo();
    throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/** Bytes still free in a CTA extension, for a UI that wants to show a budget. */
export function ctaFreeBytes(ext: CtaExtension): number {
  let used = 4;
  for (const b of ext.dataBlocks) used += 1 + encodedPayloadLength(b);
  used += ext.detailedTimings.length * 18;
  return Math.max(0, 127 - used);
}

function encodedPayloadLength(block: CtaDataBlock): number {
  switch (block.kind) {
    case "video": return block.svds.length;
    case "audio": return block.sads.length * 3;
    case "speaker-allocation": return block.raw.length;
    case "vendor-specific": return 3 + block.payload.length;
    case "extended": return 1 + block.payload.length;
    case "unknown-cta": return block.payload.length;
  }
}

/** Bytes still free in a DisplayID section. */
export function displayIdFreeBytes(ext: DisplayIdExtension): number {
  let used = 5;
  for (const db of ext.dataBlocks) used += 3 + db.payload.length;
  return Math.max(0, 127 - used);
}

// -------------------------------------------------------------- extensions

/** A fresh CTA-861 extension, revision 3, with no data blocks yet. */
export function blankCtaExtension(): CtaExtension {
  return {
    kind: "cta",
    revision: 3,
    underscanSupported: false,
    basicAudioSupported: false,
    ycbcr444Supported: false,
    ycbcr422Supported: false,
    nativeDtdCount: 0,
    sourceDtdOffset: 4,
    dataBlocks: [],
    detailedTimings: [],
    padding: new Uint8Array(128),
  };
}

/** A fresh DisplayID 2.0 extension with an empty section. */
export function blankDisplayIdExtension(): DisplayIdExtension {
  return {
    kind: "displayid",
    version: 2,
    revision: 0,
    productType: 0,
    extensionCount: 0,
    sourceSectionSize: 0,
    dataBlocks: [],
    padding: new Uint8Array(128),
    sectionChecksum: 0,
  };
}

/**
 * Append an extension block.
 *
 * `encodeEdid` re-derives base byte 126 from the extension count on its own —
 * except when an HF-EEODB is present, where byte 126 stays at its legacy value
 * and the EEODB carries the real count. So an EEODB must be bumped here too,
 * or the new block becomes invisible to an HDMI 2.1 sink.
 */
export function addExtension(edid: Edid, kind: "cta" | "displayid"): boolean {
  const ext: ExtensionBlock = kind === "cta" ? blankCtaExtension() : blankDisplayIdExtension();
  const eeodb = findEeodbBlock(edid);
  const before = eeodb ? eeodb.payload[0] ?? 0 : 0;

  return guarded(edid, `Add ${kind === "cta" ? "CTA-861" : "DisplayID"} extension`,
    () => {
      edid.extensions.push(ext);
      if (eeodb) eeodb.payload[0] = Math.min(255, edid.extensions.length);
    },
    () => {
      edid.extensions.pop();
      if (eeodb) eeodb.payload[0] = before;
    });
}

export function removeExtension(edid: Edid, index: number): boolean {
  const ext = edid.extensions[index];
  if (!ext) return false;
  const eeodb = findEeodbBlock(edid);
  const before = eeodb ? eeodb.payload[0] ?? 0 : 0;

  return guarded(edid, "Remove extension",
    () => {
      edid.extensions.splice(index, 1);
      // The EEODB may have lived in the block just removed; re-find it.
      const still = findEeodbBlock(edid);
      if (still) still.payload[0] = Math.min(255, edid.extensions.length);
    },
    () => {
      edid.extensions.splice(index, 0, ext);
      if (eeodb) eeodb.payload[0] = before;
    });
}

function findEeodbBlock(edid: Edid) {
  for (const ext of edid.extensions) {
    if (ext.kind !== "cta") continue;
    for (const block of ext.dataBlocks) {
      if (block.kind === "extended" && block.extendedTag === CtaExtendedTag.HdmiForumEeodb) return block;
    }
  }
  return null;
}

// -------------------------------------------------------- CTA data blocks

export interface CtaBlockSpec {
  /** Stable id the UI passes back to `addCtaBlock`. */
  id: string;
  label: string;
  group: string;
  make: () => CtaDataBlock;
}

const svd = (vic: number) => ({ vic, native: false });

/**
 * The catalogue of CTA data blocks a user can add.
 *
 * Each default must be a *valid minimal block*: adding it and immediately
 * encoding has to succeed, and decoding the result has to give the same block
 * back. `test/structure.test.mjs` asserts exactly that for every entry, because
 * a wrong default here would quietly produce a malformed EDID.
 */
export function ctaBlockCatalogue(): CtaBlockSpec[] {
  const ext = (id: string, label: string, tag: number, payload: number[], group = "CTA-861"): CtaBlockSpec => ({
    id, label, group,
    make: () => ({ kind: "extended", extendedTag: tag, payload: Uint8Array.from(payload) }),
  });
  const vsdb = (id: string, label: string, oui: number, payload: number[]): CtaBlockSpec => ({
    id, label, group: "Vendor (VSDB)",
    make: () => ({ kind: "vendor-specific", oui, payload: Uint8Array.from(payload) }),
  });

  return [
    { id: "video", label: "Video (SVD list)", group: "CTA-861",
      make: () => ({ kind: "video", svds: [svd(16)] }) },              // 1920x1080p60
    { id: "audio", label: "Audio (SAD list)", group: "CTA-861",
      make: () => ({ kind: "audio", sads: [{ format: 1, maxChannels: 2, sampleRates: 0x07, byte3: 0x07 }] }) },
    { id: "speaker", label: "Speaker Allocation", group: "CTA-861",
      make: () => ({ kind: "speaker-allocation", allocation: 0x01, raw: Uint8Array.from([0x01, 0, 0]) }) },

    ext("videoCapability", "Video Capability", CtaExtendedTag.VideoCapability, [0x00]),
    ext("colorimetry", "Colorimetry", CtaExtendedTag.Colorimetry, [0x00, 0x00]),
    ext("hdrStatic", "HDR Static Metadata", CtaExtendedTag.HdrStaticMetadata, [0x00, 0x00]),
    ext("vfpdb", "Video Format Preference", CtaExtendedTag.VideoFormatPreference, [0x01]),
    ext("y420vdb", "YCbCr 4:2:0 Video", CtaExtendedTag.Ycbcr420Video, [16]),
    // An empty capability map is the spec's way of saying "every SVD supports 4:2:0".
    ext("y420cmdb", "YCbCr 4:2:0 Capability Map", CtaExtendedTag.Ycbcr420CapabilityMap, []),
    ext("typeVII", "Type VII Video Timing", 0x22, [0x00, ...TYPE_VII_DEFAULT], "Timing"),
    ext("typeVIII", "Type VIII Timing Codes", 0x23, [0x01, 4, 9, 16], "Timing"),
    ext("typeX", "Type X Video Timing", 0x2a, [0x00, ...TYPE_X_DEFAULT], "Timing"),
    ext("eeodb", "HDMI Forum EEODB", CtaExtendedTag.HdmiForumEeodb, [1]),

    vsdb("hdmi14b", "HDMI 1.4b (00-0C-03)", HDMI_14B_OUI, [0x00, 0x00, 0x00, 0x00]),
    vsdb("hdmiForum", "HDMI Forum 2.1 (C4-5D-D8)", HDMI_FORUM_OUI, [0x01, 0x00, 0x00, 0x00]),
    vsdb("amdFreesync", "AMD FreeSync (00-00-1A)", AMD_FREESYNC_OUI, [0x00, 0x01, 48, 144, 0x00]),
    {
      id: "hdr10plus", label: "HDR10+ (90-84-8B)", group: "Vendor (VSDB)",
      make: () => ({ kind: "extended", extendedTag: CtaExtendedTag.VendorSpecificVideo,
        payload: Uint8Array.from([HDR10PLUS_OUI & 0xff, (HDR10PLUS_OUI >> 8) & 0xff,
          (HDR10PLUS_OUI >> 16) & 0xff, 0x01, 0x00]) }),
    },
    {
      // V2 is the smallest well-populated variant (7 bytes of vendor data).
      id: "dolbyVision", label: "Dolby Vision (00-D0-46, v2)", group: "Vendor (VSDB)",
      make: () => ({ kind: "extended", extendedTag: CtaExtendedTag.VendorSpecificVideo,
        payload: Uint8Array.from([DOLBY_VISION_OUI & 0xff, (DOLBY_VISION_OUI >> 8) & 0xff,
          (DOLBY_VISION_OUI >> 16) & 0xff, 0x4b, 0x35, 0x2c, 0x51, 0x88, 0x62, 0x1d]) }),
    },
  ];
}

/** 20-byte Type VII descriptor: 1920x1080p60, matching the blank file's DTD. */
const TYPE_VII_DEFAULT = [
  0x24, 0x44, 0x02,             // pixel clock, 148500 kHz / 1 kHz units
  0x08,                         // aspect 16:9, progressive
  0x80, 0x07, 0x18, 0x01,       // hActive 1920, hBlank 280
  0x58, 0x00, 0x2c, 0x00,       // hSyncOffset 88, hSyncWidth 44
  0x38, 0x04, 0x2d, 0x00,       // vActive 1080, vBlank 45
  0x04, 0x00, 0x05, 0x00,       // vSyncOffset 4, vSyncWidth 5
];

/** 6-byte Type X entry: 1920x1080 @ 60 Hz, standard CVT 1.2. */
const TYPE_X_DEFAULT = [0x00, 0x7f, 0x07, 0x37, 0x04, 0x3b];

export function addCtaBlock(edid: Edid, extIndex: number, specId: string): boolean {
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "cta") return false;
  const spec = ctaBlockCatalogue().find((s) => s.id === specId);
  if (!spec) return false;

  return guarded(edid, `Add "${spec.label}"`,
    () => { ext.dataBlocks.push(spec.make()); },
    () => { ext.dataBlocks.pop(); });
}

export function removeCtaBlock(edid: Edid, extIndex: number, blockIndex: number): boolean {
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "cta") return false;
  const block = ext.dataBlocks[blockIndex];
  if (!block) return false;

  return guarded(edid, "Remove CTA data block",
    () => { ext.dataBlocks.splice(blockIndex, 1); },
    () => { ext.dataBlocks.splice(blockIndex, 0, block); });
}

/** CTA extensions also carry detailed timings after the data block collection. */
export function addCtaDtd(edid: Edid, extIndex: number): boolean {
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "cta") return false;
  return guarded(edid, "Add CTA detailed timing",
    () => { ext.detailedTimings.push(defaultDtd()); },
    () => { ext.detailedTimings.pop(); });
}

export function removeCtaDtd(edid: Edid, extIndex: number, dtdIndex: number): boolean {
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "cta") return false;
  const dtd = ext.detailedTimings[dtdIndex];
  if (!dtd) return false;
  return guarded(edid, "Remove CTA detailed timing",
    () => { ext.detailedTimings.splice(dtdIndex, 1); },
    () => { ext.detailedTimings.splice(dtdIndex, 0, dtd); });
}

// ---------------------------------------------------- DisplayID data blocks

export interface DidBlockSpec { tag: number; label: string; revision: number; payload: number[]; }

/** DisplayID blocks a user can add, with minimal valid payloads. */
export function displayIdBlockCatalogue(): DidBlockSpec[] {
  return [
    { tag: DidTag.ProductIdV2, label: "Product Identification", revision: 0, payload: new Array(20).fill(0) },
    { tag: DidTag.DisplayParamsV2, label: "Display Parameters", revision: 0, payload: new Array(29).fill(0) },
    { tag: DidTag.TimingI, label: "Type I Detailed Timing", revision: 0, payload: TYPE_I_DEFAULT },
    { tag: DidTag.TimingVII, label: "Type VII Detailed Timing", revision: 0, payload: TYPE_VII_DEFAULT },
    { tag: DidTag.TimingVIII, label: "Type VIII Timing Codes", revision: 0, payload: [4, 9, 16] },
    { tag: DidTag.TimingX, label: "Type X Formula Timing", revision: 0, payload: TYPE_X_DEFAULT },
    { tag: DidTag.DynamicRangeLimits, label: "Dynamic Range Limits", revision: 0,
      payload: [0x56, 0x62, 0x00, 0x7f, 0x1a, 0x12, 48, 144, 0x00] },
    { tag: DidTag.AdaptiveSync, label: "Adaptive-Sync", revision: 0, payload: [0x00, 0x00, 48, 144, 0x00, 0x00] },
    { tag: DidTag.ContainerId, label: "Container ID", revision: 0, payload: new Array(16).fill(0) },
    { tag: DidTag.ProductSerialNumber, label: "Product Serial Number", revision: 0, payload: asciiBytes("SERIAL") },
    { tag: DidTag.AsciiString, label: "ASCII String", revision: 0, payload: asciiBytes("STRING") },
    { tag: DidTag.TiledTopologyV2, label: "Tiled Display Topology", revision: 0, payload: new Array(22).fill(0) },
  ];
}

/** 20-byte Type I detailed timing: 1920x1080p60 at 148.5 MHz. */
const TYPE_I_DEFAULT = [
  0x1c, 0x44, 0x02, 0x08,
  0x80, 0x07, 0x18, 0x01, 0x58, 0x00, 0x2c, 0x00,
  0x38, 0x04, 0x2d, 0x00, 0x04, 0x00, 0x05, 0x00,
];

function asciiBytes(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0) & 0x7f);
}

export function addDisplayIdBlock(edid: Edid, extIndex: number, tag: number): boolean {
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "displayid") return false;
  const spec = displayIdBlockCatalogue().find((s) => s.tag === tag);
  if (!spec) return false;

  return guarded(edid, `Add "${spec.label}"`,
    () => {
      ext.dataBlocks.push({ tag: spec.tag, revision: spec.revision, payload: Uint8Array.from(spec.payload) });
      // The section has to grow to cover the new block; encode keeps the
      // declared size only while the blocks still fit inside it.
      ext.sourceSectionSize = Math.max(ext.sourceSectionSize, walkedSize(ext));
    },
    () => { ext.dataBlocks.pop(); });
}

export function removeDisplayIdBlock(edid: Edid, extIndex: number, blockIndex: number): boolean {
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "displayid") return false;
  const block = ext.dataBlocks[blockIndex];
  if (!block) return false;

  return guarded(edid, "Remove DisplayID data block",
    () => { ext.dataBlocks.splice(blockIndex, 1); },
    () => { ext.dataBlocks.splice(blockIndex, 0, block); });
}

function walkedSize(ext: DisplayIdExtension): number {
  let n = 0;
  for (const db of ext.dataBlocks) n += 3 + db.payload.length;
  return n;
}

// -------------------------------------------------------- base descriptors

export const DESCRIPTOR_KINDS: { kind: Descriptor["kind"]; label: string }[] = [
  { kind: "detailed-timing", label: "Detailed Timing" },
  { kind: "range-limits", label: "Display Range Limits" },
  { kind: "product-name", label: "Product Name" },
  { kind: "serial-number", label: "Serial Number" },
  { kind: "text", label: "Unspecified Text" },
  { kind: "unknown", label: "Unused / Dummy" },
];

function defaultDtd(): DetailedTimingDescriptor {
  const t = DEFAULT_TIMING;
  return {
    kind: "detailed-timing",
    pixelClockKhz: t.pixelClockKhz,
    hActive: t.hActive, hBlank: t.hBlank,
    vActive: t.vActive, vBlank: t.vBlank,
    hSyncOffset: t.hSyncOffset, hSyncPulse: t.hSyncPulse,
    vSyncOffset: t.vSyncOffset, vSyncPulse: t.vSyncPulse,
    hSizeMm: t.hSizeMm, vSizeMm: t.vSizeMm,
    hBorder: 0, vBorder: 0,
    interlaced: false, stereo: 0, syncType: 3, syncFlags: 3,
  };
}

/**
 * Replace one of the four base descriptor slots with a different kind.
 *
 * A blank file ships slot 3 as a dummy 0x10 descriptor, so without this there is
 * no way to add a second detailed timing or a serial number to a new EDID.
 */
export function setDescriptorKind(edid: Edid, slot: number, kind: Descriptor["kind"]): boolean {
  const current = edid.base.descriptors[slot];
  if (!current) return false;
  if (current.kind === kind) return true;

  let next: Descriptor;
  switch (kind) {
    case "detailed-timing": next = defaultDtd(); break;
    case "range-limits":
      next = {
        kind: "range-limits",
        minVerticalHz: 48, maxVerticalHz: 60,
        minHorizontalKhz: 30, maxHorizontalKhz: 160,
        maxPixelClockMhz: 150,
        offsetFlags: 0, timingSupport: 0,
        extra: Uint8Array.from([0x0a, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]),
      };
      break;
    case "product-name": next = { kind: "product-name", text: "NEW MONITOR", padByte: 0x20 }; break;
    case "serial-number": next = { kind: "serial-number", text: "000000", padByte: 0x20 }; break;
    case "text": next = { kind: "text", text: "TEXT", padByte: 0x20 }; break;
    case "unknown": next = { kind: "unknown", tag: 0x10, raw: new Uint8Array(18) }; break;
  }

  return guarded(edid, `Set descriptor ${slot + 1} to ${kind}`,
    () => { edid.base.descriptors[slot] = next; },
    () => { edid.base.descriptors[slot] = current; });
}

// ------------------------------------------------------------- list counts

/**
 * Grow or shrink a repeating list in place.
 *
 * `path` is the group row's path as flatten emits it, so the UI can wire a
 * stepper straight onto the row the user is already looking at.
 */
export function setListCount(edid: Edid, path: string, count: number): boolean {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Count must be a non-negative integer, got ${count}`);
  }

  const cta = /^cta(\d+)\.(adb|vdb)$/.exec(path);
  if (cta) {
    const ext = edid.extensions[Number(cta[1])];
    if (!ext || ext.kind !== "cta") return false;
    if (cta[2] === "adb") {
      const block = ext.dataBlocks.find((b) => b.kind === "audio");
      if (!block || block.kind !== "audio") return false;
      const before = [...block.sads];
      return guarded(edid, "Set SAD count",
        () => { resize(block.sads, count, () => ({ format: 1, maxChannels: 2, sampleRates: 0x07, byte3: 0x07 })); },
        () => { block.sads.splice(0, block.sads.length, ...before); });
    }
    const block = ext.dataBlocks.find((b) => b.kind === "video");
    if (!block || block.kind !== "video") return false;
    const before = [...block.svds];
    return guarded(edid, "Set SVD count",
      () => { resize(block.svds, count, () => svd(16)); },
      () => { block.svds.splice(0, block.svds.length, ...before); });
  }

  const dtds = /^cta(\d+)\.dtds$/.exec(path);
  if (dtds) {
    const ext = edid.extensions[Number(dtds[1])];
    if (!ext || ext.kind !== "cta") return false;
    const before = [...ext.detailedTimings];
    return guarded(edid, "Set CTA detailed timing count",
      () => { resize(ext.detailedTimings, count, defaultDtd); },
      () => { ext.detailedTimings.splice(0, ext.detailedTimings.length, ...before); });
  }

  return false;
}

function resize<T>(list: T[], count: number, make: () => T): void {
  while (list.length > count) list.pop();
  while (list.length < count) list.push(make());
}

// -------------------------------------------------- addressing rows by path

/** What a matrix row refers to structurally, if anything. */
export type StructureTarget =
  | { kind: "extension"; extIndex: number; label: string }
  | { kind: "cta-block"; extIndex: number; blockIndex: number; label: string }
  | { kind: "did-block"; extIndex: number; blockIndex: number; label: string }
  | { kind: "descriptor"; slot: number; label: string };

/**
 * Resolve a flatten row path to the block it stands for.
 *
 * The UI works in row paths, the model works in array indices, and the mapping
 * is not one-to-one — vendor blocks are addressed by OUI and repeatable
 * extended tags by occurrence. Keeping that translation here means it is
 * covered by the same tests as the operations it feeds.
 */
export function structureTargetFor(edid: Edid, path: string): StructureTarget | null {
  const block = /^block(\d+)$/.exec(path);
  if (block) {
    const n = Number(block[1]);
    // Block 0 is the base block; it cannot be removed.
    if (n < 1 || n > edid.extensions.length) return null;
    const ext = edid.extensions[n - 1]!;
    return { kind: "extension", extIndex: n - 1, label: extensionLabel(ext) };
  }

  const desc = /^base\.desc(\d+)$/.exec(path);
  if (desc) {
    const slot = Number(desc[1]);
    return slot < 4 ? { kind: "descriptor", slot, label: `Descriptor ${slot + 1}` } : null;
  }

  const did = /^did(\d+)\.db(\d+)$/.exec(path);
  if (did) {
    // `cta0` / `did1` index the extensions array directly — only `block{n}`
    // is offset, because block 0 is the base block. `applyField` reads these
    // prefixes the same way.
    const extIndex = Number(did[1]);
    const ext = edid.extensions[extIndex];
    if (!ext || ext.kind !== "displayid") return null;
    const blockIndex = Number(did[2]);
    const target = ext.dataBlocks[blockIndex];
    if (!target) return null;
    return { kind: "did-block", extIndex, blockIndex, label: `DisplayID tag 0x${target.tag.toString(16)}` };
  }

  const cta = /^cta(\d+)\.(.+)$/.exec(path);
  if (!cta) return null;
  const extIndex = Number(cta[1]);
  const ext = edid.extensions[extIndex];
  if (!ext || ext.kind !== "cta") return null;
  const rest = cta[2]!;

  const find = (predicate: (b: CtaDataBlock) => boolean, label: string): StructureTarget | null => {
    const blockIndex = ext.dataBlocks.findIndex(predicate);
    return blockIndex === -1 ? null : { kind: "cta-block", extIndex, blockIndex, label };
  };

  if (rest === "vdb") return find((b) => b.kind === "video", "Video Data Block");
  if (rest === "adb") return find((b) => b.kind === "audio", "Audio Data Block");
  if (rest === "sab") return find((b) => b.kind === "speaker-allocation", "Speaker Allocation Block");

  const ext5 = /^ext(\d+)(?:_(\d+))?\.block$/.exec(rest);
  if (ext5) {
    const tag = Number(ext5[1]);
    const occurrence = ext5[2] === undefined ? 0 : Number(ext5[2]);
    let seen = 0;
    const blockIndex = ext.dataBlocks.findIndex((b) => {
      if (b.kind !== "extended" || b.extendedTag !== tag) return false;
      return seen++ === occurrence;
    });
    return blockIndex === -1 ? null
      : { kind: "cta-block", extIndex, blockIndex, label: `Extended tag ${tag}` };
  }

  const vsdb = /^vsdb\.([0-9A-F-]+)$/.exec(rest);
  if (vsdb) {
    const wanted = vsdb[1]!;
    return find(
      (b) => {
        const ref = asVendorBlock(b);
        return ref !== null && ouiToString(ref.oui) === wanted;
      },
      `Vendor block ${wanted}`);
  }

  return null;
}

function extensionLabel(ext: ExtensionBlock): string {
  if (ext.kind === "cta") return "CTA-861 extension";
  if (ext.kind === "displayid") return "DisplayID extension";
  return `Extension block (tag 0x${ext.tag.toString(16)})`;
}

/** Remove whatever the row at `path` stands for. */
export function removeAtPath(edid: Edid, path: string): boolean {
  const target = structureTargetFor(edid, path);
  if (!target) return false;
  switch (target.kind) {
    case "extension": return removeExtension(edid, target.extIndex);
    case "cta-block": return removeCtaBlock(edid, target.extIndex, target.blockIndex);
    case "did-block": return removeDisplayIdBlock(edid, target.extIndex, target.blockIndex);
    case "descriptor": return setDescriptorKind(edid, target.slot, "unknown");
  }
}

/**
 * Which extension a "+" on this row would add into, so the UI knows whether to
 * offer the CTA catalogue, the DisplayID catalogue, or nothing.
 */
export function addTargetFor(edid: Edid, path: string): { kind: "cta" | "displayid"; extIndex: number } | null {
  const block = /^block(\d+)$/.exec(path);
  if (!block) return null;
  const extIndex = Number(block[1]) - 1;
  const ext = edid.extensions[extIndex];
  if (!ext) return null;
  if (ext.kind === "cta") return { kind: "cta", extIndex };
  if (ext.kind === "displayid") return { kind: "displayid", extIndex };
  return null;
}
