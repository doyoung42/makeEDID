import type {
  Edid, CtaExtension, CtaDataBlock, DisplayIdExtension, DisplayIdDataBlock, ShortVideoDescriptor,
  DetailedTimingDescriptor, RangeLimitsDescriptor,
} from "./types.js";
import {
  asVendorBlock, parseVsdb, buildVsdb, toCtaBlock, ouiToString,
  dolbyVisionFields, setDolbyVisionField,
} from "./vsdb/index.js";
import { encodeManufacturerId } from "./base.js";
import {
  DidTag, parseDisplayParamsV2, buildDisplayParamsV2,
  parseAdaptiveSync, buildAdaptiveSync, floatToHalf,
} from "./displayid2.js";
import {
  parseTypeITiming, buildTypeITiming, parseTypeVIITiming, buildTypeVIITiming,
  parseTypeXTiming, buildTypeXTiming, TYPE_X_BASE_LENGTH,
  parseTypeVIIIOptions, buildTypeVIIIOptions, parseTypeVIIICodes, buildTypeVIIICodes,
  parseDynamicRangeLimits, buildDynamicRangeLimits,
} from "./displayidTiming.js";

/**
 * Write a single flattened field back into an EDID, addressed by the same
 * `path` that `flattenEdid` produces. This is what lets the matrix propagate
 * one model's spec across a row of derived models.
 *
 * Returns false for paths that are derived or not yet writable, so the UI can
 * grey those cells out instead of silently dropping an edit.
 */
export function applyField(edid: Edid, path: string, value: string | number | boolean): boolean {
  if (path.startsWith("base.")) return applyBase(edid, path, value);

  const cta = /^cta(\d+)\.(.+)$/.exec(path);
  if (cta) {
    const ext = edid.extensions[Number(cta[1])];
    if (!ext || ext.kind !== "cta") return false;
    return applyCta(ext, cta[2]!, value);
  }

  const did = /^did(\d+)\.(.+)$/.exec(path);
  if (did) {
    const ext = edid.extensions[Number(did[1])];
    if (!ext || ext.kind !== "displayid") return false;
    return applyDisplayId(ext, did[2]!, value);
  }
  return false;
}

/**
 * Whether `applyField` can write this path — drives read-only styling.
 *
 * This must agree with `applyField` in BOTH directions. A path the writer
 * accepts but this refuses is worse than useless: the UI greys the cell out and
 * the capability is invisible. `test/applyField.test.mjs` asserts both ways over
 * the corpus, which is how the descriptor-text case below was found.
 */
export function isFieldEditable(path: string): boolean {
  if (EDITABLE_BASE.has(path)) return true;
  // Blocks with no field-level decoder are still editable as raw hex.
  if (isRawPayloadPath(path)) return true;
  // Text descriptors: applyDescriptorField writes these three.
  if (DESCRIPTOR_TEXT.test(path)) return true;

  const baseDtd = BASE_DTD_FIELD.exec(path);
  if (baseDtd) return isDtdField(baseDtd[1]!);
  if (path.startsWith("base.est.")) return Object.hasOwn(ESTABLISHED_TIMING_BITS, path.slice(9));
  if (/^base\.std\d+\.(used|hActive|aspect|refresh)$/.test(path)) return true;
  if (EDITABLE_BASE_EXTRA.has(path)) return true;
  if (path === "base.edidVersionMajor" || path === "base.edidRevision") return true;
  if (/^base\.desc\d+\.(vMin|vMax|hMin|hMax|maxClock|timingSupport)$/.test(path)) return true;
  if (/^base\.chroma\.(red|green|blue|white)[XY]$/.test(path)) return true;

  const cta = /^cta\d+\.(.+)$/.exec(path);
  if (cta) {
    const rest = cta[1]!;
    if (EDITABLE_CTA.has(rest)) return true;
    const ctaDtd = CTA_DTD_FIELD.exec(rest);
    if (ctaDtd) return isDtdField(ctaDtd[1]!);
    if (rest === "svd.vics") return true;
    if (SAD_FIELD.test(rest)) return true;
    if (SPEAKER_FIELD.test(rest)) return true;
    if (EDITABLE_EXT_FIELD.test(rest)) return true;
    if (/^ext15\.svd\d+$/.test(rest)) return true;
    const vtdbField = /^ext(?:34|42)_\d+\.(?:t7\.(.+)|tx\d+\.(.+))$/.exec(rest);
    if (vtdbField) return isTimingField(vtdbField[1] ?? vtdbField[2]!);
    const t8Field = /^ext35_\d+\.t8\.(.+)$/.exec(rest);
    if (t8Field) return TYPE_VIII_FIELD.has(t8Field[1]!);
    const vsdb = /^vsdb\.[0-9A-F-]+\.(.+)$/.exec(rest);
    if (!vsdb) return false;
    // Dolby Vision exposes a different field set per variant, so the gate cannot
    // use a flat allowlist — it defers to the same table the writer uses.
    if (vsdb[1]!.startsWith("dv.")) return true;
    return EDITABLE_VSDB.has(vsdb[1]!);
  }

  const did = /^did\d+\.(.+)$/.exec(path);
  if (did) {
    const rest = did[1]!;
    if (rest === "versionMajor" || rest === "versionMinor" || rest === "useCase") return true;
    const timingField = /^db\d+\.(?:t7\.(.+)|tx\d+\.(.+))$/.exec(rest);
    if (timingField) return isTimingField(timingField[1] ?? timingField[2]!);
    const t8Field = /^db\d+\.t8\.(.+)$/.exec(rest);
    if (t8Field) return TYPE_VIII_FIELD.has(t8Field[1]!);
    if (/^db\d+\.(minClock|maxClock|minRefresh|maxRefresh|seamless)$/.test(rest)) return true;
    // Display Parameters (0x21), Adaptive-Sync (0x2b) and the text blocks.
    if (DID_PARAM_FIELD.test(rest)) return true;
    if (DID_ASYNC_FIELD.test(rest)) return true;
    if (/^db\d+\.text$/.test(rest)) return true;
    const db = /^db\d+\.(.+)$/.exec(rest);
    return db ? EDITABLE_TYPE_I.has(db[1]!) : false;
  }

  return false;
}

// --------------------------------------------------------------------- base

/** The three descriptor slots `applyDescriptorField` accepts. */
const DESCRIPTOR_TEXT = /^base\.desc\d+\.(name|serial|text)$/;

/** Detailed timing sub-fields, in a base descriptor slot and in a CTA DTD. */
const BASE_DTD_FIELD = /^base\.desc\d+\.dtd\.(.+)$/;
const CTA_DTD_FIELD = /^dtd\d+\.(.+)$/;
const CTA_DTD_INDEX = /^dtd(\d+)\./;

const EDITABLE_BASE = new Set([
  "base.manufacturer", "base.productCode", "base.serialNumber", "base.year",
  "base.sizeH", "base.sizeV", "base.srgb", "base.preferredTiming", "base.continuousFreq",
]);

/** Base-block fields wired in the 4th round. */
const EDITABLE_BASE_EXTRA = new Set([
  "base.week", "base.gamma",
  "base.features.standby", "base.features.suspend", "base.features.activeOff",
  "base.features.colorType",
  "base.input.bitDepth", "base.input.interface",
]);

function applyBase(edid: Edid, path: string, value: string | number | boolean): boolean {
  const b = edid.base;
  switch (path) {
    case "base.manufacturer": {
      const id = String(value).toUpperCase().trim();
      if (!/^[A-Z]{3}$/.test(id)) throw new Error("Manufacturer ID must be exactly 3 letters (A-Z)");
      encodeManufacturerId(id); // validates
      b.manufacturerId = id;
      return true;
    }
    case "base.productCode":
      b.productCode = clampInt(value, 0, 0xffff, "Product Code");
      return true;
    case "base.serialNumber":
      b.serialNumber = clampInt(value, 0, 0xffffffff, "Serial Number");
      return true;
    case "base.year":
      b.manufactureYear = clampInt(value, 1990, 1990 + 255, "Year");
      return true;
    case "base.sizeH":
      b.horizontalSizeCm = clampInt(value, 0, 255, "Horizontal Size");
      return true;
    case "base.sizeV":
      b.verticalSizeCm = clampInt(value, 0, 255, "Vertical Size");
      return true;
    case "base.srgb":
      b.features.srgbDefault = toBool(value);
      return true;
    case "base.preferredTiming":
      b.features.preferredTimingMode = toBool(value);
      return true;
    case "base.continuousFreq":
      b.features.continuousFrequency = toBool(value);
      return true;
    case "base.week":
      // The row shows "model year" when byte 16 is 0xFF; accept that back so the
      // field round-trips its own displayed value.
      if (String(value).trim().toLowerCase() === "model year") {
        b.modelYearFlag = true;
        return true;
      }
      b.manufactureWeek = clampInt(value, 0, 54, "Manufacture Week");
      b.modelYearFlag = false;
      return true;
    case "base.gamma":
      // Shown as the real gamma (1.00-3.54), stored as (gamma*100)-100.
      // 0xFF means "defined by DI-EXT" and is displayed as that phrase.
      if (String(value).trim().toLowerCase() === "defined by di-ext") {
        b.gammaRaw = 0xff;
        return true;
      }
      b.gammaRaw = Math.round(clampFloat(value, 1, 3.54, "Gamma") * 100) - 100;
      return true;
    case "base.features.standby":
      b.features.standbySupported = toBool(value);
      return true;
    case "base.features.suspend":
      b.features.suspendSupported = toBool(value);
      return true;
    case "base.features.activeOff":
      b.features.activeOffSupported = toBool(value);
      return true;
    case "base.features.colorType":
      b.features.colorType = clampInt(value, 0, 3, "Colour Encoding");
      return true;
    case "base.input.bitDepth": {
      if (b.videoInput.kind !== "digital") return false;
      const depth = clampInt(value, 0, 16, "Bit Depth");
      if (depth !== 0 && !DIGITAL_BIT_DEPTHS.includes(depth)) {
        throw new Error("Bit Depth must be 0 (undefined) or one of 6, 8, 10, 12, 14, 16");
      }
      b.videoInput.bitDepth = depth;
      return true;
    }
    case "base.input.interface":
      if (b.videoInput.kind !== "digital") return false;
      b.videoInput.videoInterface = clampInt(value, 0, 15, "Digital Interface");
      return true;
    case "base.edidVersionMajor":
      b.edidVersion = clampInt(value, 1, 255, "EDID Version");
      return true;
    case "base.edidRevision":
      b.edidRevision = clampInt(value, 0, 255, "EDID Revision");
      return true;
    default:
      if (path.startsWith("base.est.")) return applyEstablishedTiming(b, path, value);
      if (path.startsWith("base.std")) return applyStandardTiming(b, path, value);
      return applyDescriptorField(edid, path, value);
  }
}

const DIGITAL_BIT_DEPTHS = [6, 8, 10, 12, 14, 16];

/** key -> [byte index 0-2, bit]; mirrors ESTABLISHED_TIMINGS in flatten.ts. */
const ESTABLISHED_TIMING_BITS: Record<string, [number, number]> = {
  t720x400_70: [0, 7], t720x400_88: [0, 6], t640x480_60: [0, 5], t640x480_67: [0, 4],
  t640x480_72: [0, 3], t640x480_75: [0, 2], t800x600_56: [0, 1], t800x600_60: [0, 0],
  t800x600_72: [1, 7], t800x600_75: [1, 6], t832x624_75: [1, 5], t1024x768_87i: [1, 4],
  t1024x768_60: [1, 3], t1024x768_70: [1, 2], t1024x768_75: [1, 1], t1280x1024_75: [1, 0],
  t1152x870_75: [2, 7],
};

function applyEstablishedTiming(b: Edid["base"], path: string, value: string | number | boolean): boolean {
  const key = path.slice("base.est.".length);
  const entry = ESTABLISHED_TIMING_BITS[key];
  if (!entry) return false;
  const [byteIdx, bit] = entry;
  const on = toBool(value);
  const set = (v: number) => (on ? v | (1 << bit) : v & ~(1 << bit) & 0xff);

  if (byteIdx === 0) b.establishedTimings.byte0 = set(b.establishedTimings.byte0);
  else if (byteIdx === 1) b.establishedTimings.byte1 = set(b.establishedTimings.byte1);
  else b.establishedTimings.byte2 = set(b.establishedTimings.byte2);
  return true;
}

function applyStandardTiming(b: Edid["base"], path: string, value: string | number | boolean): boolean {
  const m = /^base\.std(\d+)\.(used|hActive|aspect|refresh)$/.exec(path);
  if (!m) return false;
  const i = Number(m[1]);
  if (i < 0 || i > 7) return false;
  const field = m[2]!;
  const slot = b.standardTimings[i] ?? null;

  if (field === "used") {
    // Turning a slot on needs a valid starting timing; off clears it to 0x01 0x01.
    b.standardTimings[i] = toBool(value)
      ? (slot ?? { horizontalActive: 640, aspectRatio: 1, refreshRate: 60 })
      : null;
    return true;
  }
  if (!slot) return false;

  if (field === "hActive") {
    // Stored as (px / 8) - 31, so only multiples of 8 in 256..2288 survive.
    const px = clampInt(value, 256, 2288, "Standard Timing H Active");
    if (px % 8 !== 0) throw new Error("Standard Timing H Active must be a multiple of 8");
    slot.horizontalActive = px;
    return true;
  }
  if (field === "aspect") {
    slot.aspectRatio = clampInt(value, 0, 3, "Aspect Ratio") as 0 | 1 | 2 | 3;
    return true;
  }
  slot.refreshRate = clampInt(value, 60, 123, "Standard Timing Refresh");
  return true;
}

/**
 * The 18-byte detailed timing's fields, shared by base descriptors
 * (`base.desc{i}.dtd.*`) and CTA DTDs (`cta{i}.dtd{n}.*`) — it is the same
 * structure in both places, so one writer serves both.
 *
 * Ranges come from what `encodeDetailedTiming` can actually represent: the
 * 12-bit active/blank/size fields, 10-bit horizontal sync, 6-bit vertical sync.
 * A value that does not fit would be silently truncated on encode, so it is
 * rejected here instead.
 */
const DTD_FIELD: Record<string, { min: number; max: number; label: string }> = {
  clock:        { min: 10, max: 655350, label: "Pixel Clock (kHz)" },
  hActive:      { min: 0, max: 4095, label: "H Active" },
  hBlank:       { min: 0, max: 4095, label: "H Blank" },
  vActive:      { min: 0, max: 4095, label: "V Active" },
  vBlank:       { min: 0, max: 4095, label: "V Blank" },
  hSyncOffset:  { min: 0, max: 1023, label: "H Sync Offset" },
  hSyncPulse:   { min: 0, max: 1023, label: "H Sync Pulse" },
  vSyncOffset:  { min: 0, max: 63, label: "V Sync Offset" },
  vSyncPulse:   { min: 0, max: 63, label: "V Sync Pulse" },
  hSizeMm:      { min: 0, max: 4095, label: "H Image Size (mm)" },
  vSizeMm:      { min: 0, max: 4095, label: "V Image Size (mm)" },
  hBorder:      { min: 0, max: 255, label: "H Border" },
  vBorder:      { min: 0, max: 255, label: "V Border" },
  stereo:       { min: 0, max: 7, label: "Stereo Mode" },
  syncType:     { min: 0, max: 3, label: "Sync Type" },
  syncFlags:    { min: 0, max: 3, label: "Sync Flags" },
};

/** A field name accepted by either the Type VII or the Type X writer. */
function isTimingField(field: string): boolean {
  return Object.hasOwn(TYPE_VII_FIELD, field) || Object.hasOwn(TYPE_X_FIELD, field);
}

/** `count` is derived from the code list, so it is not writable on its own. */
const TYPE_VIII_FIELD = new Set(["revision", "codeSize", "y420", "codeType", "codes"]);

/**
 * Edit one Type VIII field, returning the new options byte and payload.
 *
 * Changing the code size re-packs every existing code, so the payload length
 * changes — the encoder rewrites the block length from it.
 */
function applyTypeVIII(
  field: string, value: string | number | boolean,
  carrier: "cta" | "displayid", optionsByte: number, payload: Uint8Array,
): { options: number; payload: Uint8Array } | null {
  if (!TYPE_VIII_FIELD.has(field)) return null;
  const o = parseTypeVIIIOptions(optionsByte, carrier);
  let codes = parseTypeVIIICodes(payload, o.codeSize);

  switch (field) {
    case "revision": o.blockRevision = clampInt(value, 0, 7, "Type VIII Block Revision"); break;
    case "codeSize": o.codeSize = clampInt(value, 1, 2, "Type VIII Code Size") === 2 ? 2 : 1; break;
    case "y420": o.supportsY420 = toBool(value); break;
    case "codeType": o.codeType = clampInt(value, 0, 3, "Type VIII Code Type"); break;
    case "codes": codes = parseCodeList(value, o.codeSize); break;
  }
  // A 2-byte code cannot survive a shrink to 1 byte, so clamp rather than wrap.
  const limit = o.codeSize === 2 ? 0xffff : 0xff;
  codes = codes.map((c) => Math.min(c, limit));
  return { options: buildTypeVIIIOptions(o, carrier), payload: buildTypeVIIICodes(codes, o.codeSize) };
}

function parseCodeList(value: string | number | boolean, codeSize: number): number[] {
  const limit = codeSize === 2 ? 0xffff : 0xff;
  const text = String(value).trim();
  if (text === "") return [];
  return text.split(/[,\s]+/).map((token) => {
    const n = Number(token);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > limit) {
      throw new Error("Type VIII timing code \"" + token + "\" must be an integer in 0..." + limit);
    }
    return n;
  });
}

const DRL_FIELD: Record<string, { min: number; max: number; label: string } | "bool"> = {
  minClock: { min: 1, max: 0x1000000, label: "Min Pixel Clock (kHz)" },
  maxClock: { min: 1, max: 0x1000000, label: "Max Pixel Clock (kHz)" },
  minRefresh: { min: 0, max: 255, label: "Min Refresh Rate (Hz)" },
  maxRefresh: { min: 0, max: 255, label: "Max Refresh Rate (Hz)" },
  seamless: "bool",
};

function applyDynamicRangeLimits(
  payload: Uint8Array, field: string, value: string | number | boolean,
): boolean {
  const spec = DRL_FIELD[field];
  if (!spec) return false;
  let d;
  try { d = parseDynamicRangeLimits(payload); } catch { return false; }

  if (spec === "bool") {
    d.seamlessDynamicVideo = toBool(value);
  } else {
    const n = clampInt(value, spec.min, spec.max, spec.label);
    if (field === "minClock") d.minPixelClockKhz = n;
    else if (field === "maxClock") d.maxPixelClockKhz = n;
    else if (field === "minRefresh") d.minRefreshRateHz = n;
    else d.maxRefreshRateHz = n;
  }
  payload.set(buildDynamicRangeLimits(d));
  return true;
}

export function isDtdField(field: string): boolean {
  return field === "interlaced" || Object.hasOwn(DTD_FIELD, field);
}

function applyDtdField(d: DetailedTimingDescriptor, field: string, value: string | number | boolean): boolean {
  if (field === "interlaced") { d.interlaced = toBool(value); return true; }

  const spec = DTD_FIELD[field];
  if (!spec) return false;
  const n = clampInt(value, spec.min, spec.max, spec.label);

  // The pixel clock is stored in 10 kHz units, so only multiples survive encode.
  if (field === "clock") { d.pixelClockKhz = Math.round(n / 10) * 10; return true; }

  (d as unknown as Record<string, number>)[field] = n;
  return true;
}

/**
 * Display Range Limits.
 *
 * The four rate limits are stored in one byte each, and byte 4 carries a
 * per-limit "+255" flag. Encode subtracts the offset back out, so writing a
 * value above 255 without setting its flag would silently wrap (300 would come
 * back as 44). The flag is therefore derived from the value here rather than
 * exposed as a separate field for the user to keep in sync by hand.
 */
const RANGE_LIMIT_FIELD: Record<string, { bit: number; label: string }> = {
  vMin: { bit: 0, label: "Vertical Rate Min" },
  vMax: { bit: 1, label: "Vertical Rate Max" },
  hMin: { bit: 2, label: "Horizontal Rate Min" },
  hMax: { bit: 3, label: "Horizontal Rate Max" },
};

function applyRangeLimitField(
  d: RangeLimitsDescriptor, field: string, value: string | number | boolean,
): boolean {
  if (field === "maxClock") {
    // Stored in 10 MHz units.
    const mhz = clampInt(value, 0, 2550, "Max Pixel Clock");
    d.maxPixelClockMhz = Math.round(mhz / 10) * 10;
    return true;
  }
  if (field === "timingSupport") {
    d.timingSupport = clampInt(value, 0, 255, "Timing Support Flags");
    return true;
  }

  const spec = RANGE_LIMIT_FIELD[field];
  if (!spec) return false;

  const n = clampInt(value, 0, 510, spec.label);
  const needsOffset = n > 255;
  d.offsetFlags = needsOffset
    ? d.offsetFlags | (1 << spec.bit)
    : d.offsetFlags & ~(1 << spec.bit) & 0xff;

  if (field === "vMin") d.minVerticalHz = n;
  else if (field === "vMax") d.maxVerticalHz = n;
  else if (field === "hMin") d.minHorizontalKhz = n;
  else d.maxHorizontalKhz = n;
  return true;
}

function applyDescriptorField(edid: Edid, path: string, value: string | number | boolean): boolean {
  const range = /^base\.desc(\d+)\.(vMin|vMax|hMin|hMax|maxClock|timingSupport)$/.exec(path);
  if (range) {
    const slot = edid.base.descriptors[Number(range[1])];
    if (!slot || slot.kind !== "range-limits") return false;
    return applyRangeLimitField(slot, range[2]!, value);
  }

  const chroma = /^base\.chroma\.(redX|redY|greenX|greenY|blueX|blueY|whiteX|whiteY)$/.exec(path);
  if (chroma) {
    edid.base.chromaticity[chroma[1]! as keyof typeof edid.base.chromaticity] =
      clampInt(value, 0, 1023, "Chromaticity coordinate");
    return true;
  }

  const raw = /^base\.desc(\d+)\.raw$/.exec(path);
  if (raw) {
    const slot = edid.base.descriptors[Number(raw[1])];
    if (!slot || slot.kind !== "unknown") return false;
    const bytes = parseHexPayload(value, 18, "Descriptor bytes");
    if (bytes.length !== 18) throw new Error("A descriptor slot is exactly 18 bytes");
    slot.raw = bytes;
    return true;
  }

  const dtd = /^base\.desc(\d+)\.dtd\.(.+)$/.exec(path);
  if (dtd) {
    const slot = edid.base.descriptors[Number(dtd[1])];
    if (!slot || slot.kind !== "detailed-timing") return false;
    return applyDtdField(slot, dtd[2]!, value);
  }

  const m = /^base\.desc(\d+)\.(name|serial|text)$/.exec(path);
  if (!m) return false;
  const d = edid.base.descriptors[Number(m[1])];
  if (!d) return false;
  const text = String(value);
  if (text.length > 13) throw new Error("EDID text descriptors hold at most 13 characters");
  if (m[2] === "name" && d.kind === "product-name") { d.text = text; return true; }
  if (m[2] === "serial" && d.kind === "serial-number") { d.text = text; return true; }
  if (m[2] === "text" && d.kind === "text") { d.text = text; return true; }
  return false;
}

// ---------------------------------------------------------------------- CTA

const EDITABLE_CTA = new Set(["underscan", "basicAudio", "ycbcr444", "ycbcr422", "nativeDtds"]);

const SAD_FIELD = /^sad\d+\.(format|maxChannels|rate32|rate44_1|rate48|rate88_2|rate96|rate176_4|rate192|byte3)$/;
const SPEAKER_FIELD =
  /^speaker\.(flFr|lfe1|fc|blBr|bc|flcFrc|rlcRrc|flwFrw|tflTfr|tc|tfc|lsRs|lfe2|tbc|slSr|tslTsr|tblTbr|bfc|bflBfr|tlsTrs)$/;

/** [path suffix, byte within the 3-byte descriptor, bit index]. */
const SAMPLE_RATE_BITS: Record<string, number> = {
  rate32: 0, rate44_1: 1, rate48: 2, rate88_2: 3, rate96: 4, rate176_4: 5, rate192: 6,
};

/** [path key, byte index 0-2, bit index], matching flatten.ts's SPEAKER_FLAGS table. */
const SPEAKER_BITS: Record<string, [number, number]> = {
  flFr: [0, 0], lfe1: [0, 1], fc: [0, 2], blBr: [0, 3], bc: [0, 4], flcFrc: [0, 5],
  rlcRrc: [0, 6], flwFrw: [0, 7],
  tflTfr: [1, 0], tc: [1, 1], tfc: [1, 2], lsRs: [1, 3], lfe2: [1, 4], tbc: [1, 5],
  slSr: [1, 6], tslTsr: [1, 7],
  tblTbr: [2, 0], bfc: [2, 1], bflBfr: [2, 2], tlsTrs: [2, 3],
};

function applyCta(ext: CtaExtension, rest: string, value: string | number | boolean): boolean {
  switch (rest) {
    case "underscan":   ext.underscanSupported = toBool(value); return true;
    case "basicAudio":  ext.basicAudioSupported = toBool(value); return true;
    case "ycbcr444":    ext.ycbcr444Supported = toBool(value); return true;
    case "ycbcr422":    ext.ycbcr422Supported = toBool(value); return true;
    case "nativeDtds":  ext.nativeDtdCount = clampInt(value, 0, 15, "Native DTD Count"); return true;
    // `revision` is deliberately NOT writable. encodeCtaExtension takes a
    // different branch below revision 3 — it drops the data block collection and
    // writes padding in its place — so an innocent-looking 3 -> 2 edit would
    // silently destroy every data block. test/corpus/span.test.mjs caught this
    // when the field was briefly made editable.
  }

  const ctaDtd = CTA_DTD_FIELD.exec(rest);
  if (ctaDtd) {
    const dtd = ext.detailedTimings[Number(CTA_DTD_INDEX.exec(rest)![1])];
    return dtd ? applyDtdField(dtd, ctaDtd[1]!, value) : false;
  }

  if (rest === "svd.vics") return applySvdList(ext, value);

  const sad = /^sad(\d+)\.(.+)$/.exec(rest);
  if (sad && SAD_FIELD.test(rest)) return applySadField(ext, Number(sad[1]), sad[2]!, value);

  const speaker = SPEAKER_FIELD.exec(rest);
  if (speaker) return applySpeakerField(ext, speaker[1]!, value);

  const vtdb = /^ext(34|42)_(\d+)\.(?:t7\.(.+)|tx(\d+)\.(.+))$/.exec(rest);
  if (vtdb) {
    const found = findExtendedBlock(ext, Number(vtdb[1]), Number(vtdb[2]));
    if (!found || found.block.payload.length < 1) return false;
    const options = found.block.payload[0]!;
    if (vtdb[3] !== undefined) {
      // Type VII: one descriptor, starting after the options byte.
      return writeTypeVII(found.block.payload, 1, (options >> 4) & 0x07, vtdb[3], value);
    }
    const stride = TYPE_X_BASE_LENGTH + ((options >> 4) & 0x07);
    return writeTypeX(found.block.payload, 1, stride, Number(vtdb[4]), vtdb[5]!, value);
  }

  const t8 = /^ext35_(\d+)\.t8\.(.+)$/.exec(rest);
  if (t8) {
    const found = findExtendedBlock(ext, 35, Number(t8[1]));
    if (!found || found.block.payload.length < 1) return false;
    const next = applyTypeVIII(t8[2]!, value, "cta", found.block.payload[0]!,
      found.block.payload.subarray(1));
    if (!next) return false;
    const merged = new Uint8Array(1 + next.payload.length);
    merged[0] = next.options;
    merged.set(next.payload, 1);
    found.block.payload = merged;
    return true;
  }

  const y420 = /^ext15\.svd(\d+)$/.exec(rest);
  if (y420) {
    const found = findExtendedBlock(ext, 15);
    if (!found) return false;
    const index = Number(y420[1]);
    const byteIndex = index >> 3;
    if (byteIndex >= found.block.payload.length) return false;
    setBitIn(found.block.payload, byteIndex, index & 7, toBool(value));
    return true;
  }

  // Catch-all for `ext<tag>.<field>`. It must stay below every structured
  // handler above: its pattern also matches the Type VII/VIII/X and Y420 paths,
  // so returning from here first would make those unreachable — the gate would
  // still call the field editable and the edit would silently do nothing.
  const ext5 = EXT_TAG_FIELD.exec(rest);
  if (ext5) return applyExtendedField(ext, Number(ext5[1]), ext5[2]!, value);

  if (isRawPayloadPath("cta0." + rest)) return applyCtaRawPayload(ext, rest, value);

  const m = /^vsdb\.([0-9A-F-]+)\.(.+)$/.exec(rest);
  if (!m) return false;
  return applyVsdbField(ext, m[1]!, m[2]!, value);
}

/**
 * Replace the whole SVD list from its display text, e.g. "97*, 96, 95" — the
 * same "VIC, * for native" format flatten.ts renders. The block can grow or
 * shrink; the layout is recomputed fresh on every flatten, so nothing else
 * needs to know the count changed.
 */
function applySvdList(ext: CtaExtension, value: string | number | boolean): boolean {
  const index = ext.dataBlocks.findIndex((b) => b.kind === "video");
  if (index === -1) return false;

  const text = String(value).trim();
  const tokens = text.length === 0 ? [] : text.split(",").map((t) => t.trim()).filter(Boolean);
  const svds: ShortVideoDescriptor[] = tokens.map((t) => {
    const native = t.endsWith("*");
    const numeric = native ? t.slice(0, -1).trim() : t;
    const vic = Number(numeric);
    if (!Number.isInteger(vic) || vic < 1 || vic > 255) {
      throw new Error(`"${t}" is not a valid VIC (1-255, optionally followed by * for native)`);
    }
    return { vic, native };
  });
  if (svds.length > 31) throw new Error("A CTA data block holds at most 31 bytes — too many SVDs");

  ext.dataBlocks[index] = { kind: "video", svds };
  return true;
}

function applySadField(ext: CtaExtension, sadIndex: number, field: string, value: string | number | boolean): boolean {
  const blockIndex = ext.dataBlocks.findIndex((b) => b.kind === "audio");
  if (blockIndex === -1) return false;
  const block = ext.dataBlocks[blockIndex];
  if (!block || block.kind !== "audio") return false;
  const sad = block.sads[sadIndex];
  if (!sad) return false;

  if (field === "format") { sad.format = clampInt(value, 1, 15, "Audio Format"); return true; }
  if (field === "maxChannels") { sad.maxChannels = clampInt(value, 1, 8, "Max Channels"); return true; }
  if (field === "byte3") {
    const s = String(value).trim();
    const n = /^0x/i.test(s) ? parseInt(s, 16) : Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Byte 3 must be 0-255 (or 0x00-0xFF)");
    sad.byte3 = n;
    return true;
  }
  const bit = SAMPLE_RATE_BITS[field];
  if (bit === undefined) return false;
  const on = toBool(value);
  sad.sampleRates = on ? sad.sampleRates | (1 << bit) : sad.sampleRates & ~(1 << bit) & 0x7f;
  return true;
}

// -------------------------------------------------------- CTA extended tags

const EXT_TAG_FIELD = /^ext(\d+)\.(.+)$/;

const EDITABLE_EXT_FIELD =
  /^ext(5\.(xvycc601|xvycc709|sycc601|opycc601|oprgb|bt2020cycc|bt2020ycc|bt2020rgb|ictcp|dcip3)|6\.(eotf[0-3]|maxLum|avgLum|minLum)|0\.(qy|qs|spt|sit|sce))$/;

/** Mirrors flatten.ts's COLORIMETRY_FLAGS: [byteOffset, bit, path suffix]. */
const COLORIMETRY_BITS: Record<string, [number, number]> = {
  xvycc601: [0, 0], xvycc709: [0, 1], sycc601: [0, 2], opycc601: [0, 3], oprgb: [0, 4],
  bt2020cycc: [0, 5], bt2020ycc: [0, 6], bt2020rgb: [0, 7],
  ictcp: [1, 6], dcip3: [1, 7],
};

/**
 * Locate the `occurrence`-th block carrying `tag`. Most extended tags appear at
 * most once, but the Type VII/VIII/X timing blocks repeat, and flatten gives
 * each occurrence its own path — so the writer has to select the same one or it
 * edits the wrong block's bytes.
 */
function findExtendedBlock(ext: CtaExtension, tag: number, occurrence = 0) {
  let seen = 0;
  const index = ext.dataBlocks.findIndex((b) => {
    if (b.kind !== "extended" || b.extendedTag !== tag) return false;
    return seen++ === occurrence;
  });
  const block = index === -1 ? null : ext.dataBlocks[index];
  return block && block.kind === "extended" ? { index, block } : null;
}

function applyExtendedField(ext: CtaExtension, tag: number, field: string, value: string | number | boolean): boolean {
  const found = findExtendedBlock(ext, tag);
  if (!found) return false;
  const { payload } = found.block;

  if (tag === 5) {   // Colorimetry
    const bits = COLORIMETRY_BITS[field];
    if (!bits || payload.length < 2) return false;
    const [byteOffset, bit] = bits;
    setBitIn(payload, byteOffset, bit, toBool(value));
    return true;
  }

  if (tag === 6) {   // HDR Static Metadata
    const eotfBit = /^eotf([0-3])$/.exec(field);
    if (eotfBit) { setBitIn(payload, 0, Number(eotfBit[1]), toBool(value)); return true; }
    if (field === "maxLum" && payload.length > 2) { payload[2] = clampInt(value, 0, 255, "Max Luminance"); return true; }
    if (field === "avgLum" && payload.length > 3) { payload[3] = clampInt(value, 0, 255, "Max Frame-Avg Luminance"); return true; }
    if (field === "minLum" && payload.length > 4) { payload[4] = clampInt(value, 0, 255, "Min Luminance"); return true; }
    return false;
  }

  if (tag === 0 && payload.length >= 1) {   // Video Capability
    const b = payload[0]!;
    if (field === "qy") { payload[0] = on(b, 7, toBool(value)); return true; }
    if (field === "qs") { payload[0] = on(b, 6, toBool(value)); return true; }
    if (field === "spt") { payload[0] = twoBit(b, 4, clampInt(value, 0, 3, "S_PT")); return true; }
    if (field === "sit") { payload[0] = twoBit(b, 2, clampInt(value, 0, 3, "S_IT")); return true; }
    if (field === "sce") { payload[0] = twoBit(b, 0, clampInt(value, 0, 3, "S_CE")); return true; }
    return false;
  }

  return false;
}

function setBitIn(payload: Uint8Array, byteOffset: number, bit: number, set: boolean): void {
  payload[byteOffset] = on(payload[byteOffset] ?? 0, bit, set);
}

function on(byte: number, bit: number, set: boolean): number {
  return set ? byte | (1 << bit) : byte & ~(1 << bit) & 0xff;
}

function twoBit(byte: number, shift: number, value: number): number {
  return (byte & ~(0b11 << shift) & 0xff) | ((value & 0b11) << shift);
}

function applySpeakerField(ext: CtaExtension, key: string, value: string | number | boolean): boolean {
  const index = ext.dataBlocks.findIndex((b) => b.kind === "speaker-allocation");
  if (index === -1) return false;
  const block = ext.dataBlocks[index];
  if (!block || block.kind !== "speaker-allocation") return false;

  const bits = SPEAKER_BITS[key];
  if (!bits) return false;
  const [byteIndex, bit] = bits;
  const raw = Uint8Array.from(block.raw.length >= 3 ? block.raw : [block.raw[0] ?? 0, 0, 0]);
  const on = toBool(value);
  raw[byteIndex] = on ? raw[byteIndex]! | (1 << bit) : raw[byteIndex]! & ~(1 << bit) & 0xff;

  ext.dataBlocks[index] = { kind: "speaker-allocation", allocation: raw[0]!, raw };
  return true;
}

// --------------------------------------------------------------------- VSDB

const EDITABLE_VSDB = new Set([
  // HDMI 1.4b
  "phyAddr", "maxTmds", "dc30", "dc36", "dc48", "dcY444", "ai", "dviDual",
  "videoLatency", "audioLatency", "iVideoLatency", "iAudioLatency",
  "cncGame", "cncCinema", "cncPhoto", "cncGraphics",
  "imageSize", "3dPresent", "3dMulti", "hdmiVics",
  // HDMI Forum
  "version", "maxFrl", "scdc", "dc30_420", "dc36_420", "dc48_420",
  "allm", "fva", "qms", "cinemaVrr", "vrrMin", "vrrMax",
  "dsc1p2", "dscNative420", "dscMaxFrl", "dscMaxSlices", "dscChunk",
  // HDR10+
  "appVersion", "peakIndex", "ffPeakIndex",
  // AMD FreeSync
  "supported", "native", "localDimming", "minHz", "maxHz", "mccs", "lsbHz",
  "gammaBits", "maxLum1", "minLum1Code", "maxLum2", "minLum2Code",
  // HDMI Forum, wired in the 4th round
  "rrCapable", "cableStatus", "ccbpci", "lte340Scramble", "independentView",
  "dualView", "osdDisparity3d", "uhdVic",
  "negMvrr", "mdelta", "fapaStart", "fapaEndExt",
  "dsc10bpc", "dsc12bpc", "dsc16bpc", "dscAllBpp", "qmsTfrMin", "qmsTfrMax",
]);

function applyVsdbField(
  ext: CtaExtension, ouiKey: string, field: string, value: string | number | boolean,
): boolean {
  const index = ext.dataBlocks.findIndex((b) => {
    const ref = asVendorBlock(b);
    return ref !== null && ouiToString(ref.oui) === ouiKey;
  });
  if (index === -1) return false;

  const ref = asVendorBlock(ext.dataBlocks[index] as CtaDataBlock);
  if (!ref) return false;
  const view = parseVsdb(ref);

  if (view.type === "hdmi14b") {
    const d = view.data;
    switch (field) {
      case "phyAddr": {
        const parts = String(value).split(".").map((s) => Number(s.trim()));
        if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 15)) {
          throw new Error("Physical address must be four values 0-15, like 1.0.0.0");
        }
        d.physicalAddress = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
        break;
      }
      case "maxTmds": d.maxTmdsClockMhz = clampInt(value, 0, 1275, "Max TMDS Clock"); break;
      case "dc30":    d.dc30bit = toBool(value); break;
      case "dc36":    d.dc36bit = toBool(value); break;
      case "dc48":    d.dc48bit = toBool(value); break;
      case "dcY444":  d.dcY444 = toBool(value); break;
      case "ai":      d.supportsAi = toBool(value); break;
      case "dviDual": d.dviDualLink = toBool(value); break;
      case "videoLatency": if (!d.latency) return false; d.latency.video = clampInt(value, 0, 255, "Video Latency"); break;
      case "audioLatency": if (!d.latency) return false; d.latency.audio = clampInt(value, 0, 255, "Audio Latency"); break;
      case "iVideoLatency": if (!d.interlacedLatency) return false; d.interlacedLatency.video = clampInt(value, 0, 255, "Interlaced Video Latency"); break;
      case "iAudioLatency": if (!d.interlacedLatency) return false; d.interlacedLatency.audio = clampInt(value, 0, 255, "Interlaced Audio Latency"); break;
      case "cncGame": if (!d.flags) return false; d.flags.supportsGame = toBool(value); break;
      case "cncCinema": if (!d.flags) return false; d.flags.supportsCinema = toBool(value); break;
      case "cncPhoto": if (!d.flags) return false; d.flags.supportsPhoto = toBool(value); break;
      case "cncGraphics": if (!d.flags) return false; d.flags.supportsGraphics = toBool(value); break;
      // The video section's flag byte is written verbatim by buildVideoSection,
      // while these three fields are decode-time views of it. Both must move
      // together or the emitted byte and the model would disagree.
      case "imageSize": {
        if (!d.video) return false;
        const n = clampInt(value, 0, 3, "Image Size Meaning");
        d.video.imageSize = n;
        d.video.flagsRaw = (d.video.flagsRaw & ~0x18 & 0xff) | (n << 3);
        break;
      }
      case "3dPresent": {
        if (!d.video) return false;
        const on = toBool(value);
        d.video.threeDPresent = on;
        d.video.flagsRaw = on ? d.video.flagsRaw | 0x80 : d.video.flagsRaw & ~0x80 & 0xff;
        break;
      }
      case "3dMulti": {
        if (!d.video) return false;
        const n = clampInt(value, 0, 3, "3D Multi Present");
        d.video.threeDMultiPresent = n;
        d.video.flagsRaw = (d.video.flagsRaw & ~0x60 & 0xff) | (n << 5);
        break;
      }
      case "hdmiVics": {
        if (!d.video) return false;
        const text = String(value).trim();
        const vics = text.length === 0 ? [] : text.split(",").map((t) => {
          const n = Number(t.trim());
          if (!Number.isInteger(n) || n < 0 || n > 255) {
            throw new Error(`"${t.trim()}" is not a valid HDMI VIC (0-255)`);
          }
          return n;
        });
        if (vics.length > 7) throw new Error("The HDMI_VIC list holds at most 7 entries");
        d.video.hdmiVics = vics;
        break;
      }
      default: return false;
    }
  } else if (view.type === "hdmi-forum") {
    const d = view.data;
    switch (field) {
      case "version":      d.version = clampInt(value, 0, 255, "Version"); break;
      case "maxTmds":      d.maxTmdsClockMhz = clampInt(value, 0, 1275, "Max TMDS Character Rate"); break;
      case "maxFrl":       d.maxFrlRate = clampInt(value, 0, 15, "Max FRL Rate"); break;
      case "scdc":            d.scdcPresent = toBool(value); break;
      case "rrCapable":       d.rrCapable = toBool(value); break;
      case "cableStatus":     d.cableStatus = toBool(value); break;
      case "ccbpci":          d.ccbpci = toBool(value); break;
      case "lte340Scramble":  d.lte340MhzScramble = toBool(value); break;
      case "independentView": d.independentView = toBool(value); break;
      case "dualView":        d.dualView = toBool(value); break;
      case "osdDisparity3d":  d.osdDisparity3d = toBool(value); break;
      case "uhdVic":          d.uhdVic = toBool(value); break;
      case "dc30_420":     d.dc30bit420 = toBool(value); break;
      case "dc36_420":     d.dc36bit420 = toBool(value); break;
      case "dc48_420":     d.dc48bit420 = toBool(value); break;
      case "allm":         if (!d.ext) return false; d.ext.allm = toBool(value); break;
      case "fva":          if (!d.ext) return false; d.ext.fva = toBool(value); break;
      case "qms":          if (!d.ext) return false; d.ext.qms = toBool(value); break;
      case "cinemaVrr":    if (!d.ext) return false; d.ext.cinemaVrr = toBool(value); break;
      case "negMvrr":      if (!d.ext) return false; d.ext.negMvrr = toBool(value); break;
      case "mdelta":       if (!d.ext) return false; d.ext.mdelta = toBool(value); break;
      case "fapaStart":    if (!d.ext) return false; d.ext.fapaStartLocation = toBool(value); break;
      case "fapaEndExt":   if (!d.ext) return false; d.ext.fapaEndExtended = toBool(value); break;
      case "vrrMin":       if (!d.vrr) return false; d.vrr.min = clampInt(value, 0, 63, "VRR Min"); break;
      case "vrrMax":       if (!d.vrr) return false; d.vrr.max = clampInt(value, 0, 1023, "VRR Max"); break;
      case "dsc1p2":       if (!d.dsc) return false; d.dsc.dsc1p2 = toBool(value); break;
      case "dscNative420": if (!d.dsc) return false; d.dsc.dscNative420 = toBool(value); break;
      case "dscMaxFrl":    if (!d.dsc) return false; d.dsc.maxFrlRate = clampInt(value, 0, 15, "DSC Max FRL Rate"); break;
      case "dscMaxSlices": if (!d.dsc) return false; d.dsc.maxSlices = clampInt(value, 0, 15, "DSC Max Slices"); break;
      case "dsc10bpc":     if (!d.dsc) return false; d.dsc.dsc10bpc = toBool(value); break;
      case "dsc12bpc":     if (!d.dsc) return false; d.dsc.dsc12bpc = toBool(value); break;
      case "dsc16bpc":     if (!d.dsc) return false; d.dsc.dsc16bpc = toBool(value); break;
      case "dscAllBpp":    if (!d.dsc) return false; d.dsc.dscAllBpp = toBool(value); break;
      case "qmsTfrMin":    if (!d.dsc) return false; d.dsc.qmsTfrMin = toBool(value); break;
      case "qmsTfrMax":    if (!d.dsc) return false; d.dsc.qmsTfrMax = toBool(value); break;
      case "dscChunk":     if (!d.dsc) return false; d.dsc.totalChunkKBytes = clampInt(value, 0, 63, "DSC Total Chunk kBytes"); break;
      default: return false;
    }
  } else if (view.type === "hdr10plus") {
    const d = view.data;
    switch (field) {
      case "appVersion":   d.applicationVersion = clampInt(value, 0, 3, "HDR10+ Application Version"); break;
      case "peakIndex":    d.peakLuminanceIndex = clampInt(value, 0, 15, "Peak Luminance Index"); break;
      case "ffPeakIndex":  d.fullFramePeakLuminanceIndex = clampInt(value, 0, 3, "Full-Frame Peak Luminance Index"); break;
      default: return false;
    }
  } else if (view.type === "amd-freesync") {
    const d = view.data;
    const setFlag = (bitIndex: number, on: boolean) => {
      d.flagsRaw = on ? d.flagsRaw | (1 << bitIndex) : d.flagsRaw & ~(1 << bitIndex);
    };
    switch (field) {
      case "version":      d.version = clampInt(value, 0, 255, "FreeSync Version"); break;
      case "supported":    d.freesyncSupported = toBool(value); setFlag(0, d.freesyncSupported); break;
      case "native":       d.native = toBool(value); setFlag(1, d.native); break;
      case "localDimming": d.localDimmingDisable = toBool(value); setFlag(3, d.localDimmingDisable); break;
      case "minHz":        d.minRefreshHz = clampInt(value, 0, 255, "FreeSync Min Refresh"); break;
      case "maxHz":        d.maxRefreshHz = clampInt(value, 0, 255, "FreeSync Max Refresh"); break;
      case "mccs":         d.mccsVcpSupport = clampInt(value, 0, 255, "MCCS VCP Support"); break;
      case "lsbHz":        d.maxLsbFreesyncRefreshHz = clampInt(value, 0, 65535, "Max LSB FreeSync Refresh"); break;
      case "gammaBits":    d.gammaBits = clampInt(value, 0, 255, "Gamma Bits"); break;
      case "maxLum1":      d.maxLuminance1 = clampInt(value, 0, 255, "Max Luminance 1"); break;
      // The cd/m² row is a decompressed view; the raw code is what is writable.
      case "minLum1Code":  d.minLuminance1Raw = clampInt(value, 0, 255, "Min Luminance 1 code"); break;
      case "maxLum2":      d.maxLuminance2 = clampInt(value, 0, 255, "Max Luminance 2"); break;
      case "minLum2Code":  d.minLuminance2Raw = clampInt(value, 0, 255, "Min Luminance 2 code"); break;
      default: return false;
    }
  } else if (view.type === "dolby-vision") {
    if (field === "version") {
      view.data.version = clampInt(value, 0, 7, "Dolby Vision Version");
    } else if (field.startsWith("dv.")) {
      const key = field.slice(3);
      const spec = dolbyVisionFields(view.data).find((x) => x.key === key);
      if (!spec) return false;
      const next = spec.kind === "boolean" ? toBool(value) : clampInt(value, 0, 4095, spec.label);
      if (!setDolbyVisionField(view.data, key, next)) return false;
    } else {
      return false;
    }
  } else {
    return false;
  }

  ext.dataBlocks[index] = toCtaBlock(ref, buildVsdb(view));
  return true;
}

// ------------------------------------------------ Type VII / Type X timings

const TYPE_VII_FIELD: Record<string, { min: number; max: number; label: string } | "bool"> = {
  clock: { min: 0.001, max: 16777.216, label: "Type VII Pixel Clock (MHz)" },
  aspect: { min: 0, max: 15, label: "Aspect Ratio" },
  support3d: { min: 0, max: 3, label: "3D Support" },
  hActive: { min: 1, max: 65536, label: "H Active" },
  hBlank: { min: 1, max: 65536, label: "H Blank" },
  hSyncOffset: { min: 1, max: 32768, label: "H Sync Offset" },
  hSyncWidth: { min: 1, max: 65536, label: "H Sync Width" },
  vActive: { min: 1, max: 65536, label: "V Active" },
  vBlank: { min: 1, max: 65536, label: "V Blank" },
  vSyncOffset: { min: 1, max: 32768, label: "V Sync Offset" },
  vSyncWidth: { min: 1, max: 65536, label: "V Sync Width" },
  interlaced: "bool", y420: "bool", hSyncPositive: "bool", vSyncPositive: "bool",
};

const TYPE_X_FIELD: Record<string, { min: number; max: number; label: string } | "bool"> = {
  algorithm: { min: 0, max: 7, label: "Timing Formula" },
  support3d: { min: 0, max: 3, label: "3D Support" },
  hActive: { min: 1, max: 65536, label: "H Active" },
  vActive: { min: 1, max: 65536, label: "V Active" },
  refresh: { min: 1, max: 1024, label: "Refresh Rate" },
  deltaHBlank: { min: 0, max: 7, label: "H Blank Delta" },
  deltaVBlank: { min: 0, max: 7, label: "V Blank Delta" },
  y420: "bool", altMinVblank: "bool",
};

/** Write one Type VII field, given the descriptor bytes and its extra length. */
function writeTypeVII(
  payload: Uint8Array, offset: number, extra: number, field: string, value: string | number | boolean,
): boolean {
  const spec = TYPE_VII_FIELD[field];
  if (!spec) return false;
  const body = payload.subarray(offset);
  const t = parseTypeVIITiming(body, extra);

  if (spec === "bool") {
    const on = toBool(value);
    if (field === "interlaced") t.interlaced = on;
    else if (field === "y420") t.supportsY420 = on;
    else if (field === "hSyncPositive") t.hSyncPositive = on;
    else t.vSyncPositive = on;
  } else if (field === "clock") {
    t.pixelClockMhz = clampFloat(value, spec.min, spec.max, spec.label);
  } else {
    // The path suffix and the model property are not always spelled the same.
    // Assigning an unknown name would create a phantom property: the write
    // reports success, the encoder never reads it, and the edit vanishes.
    const prop = field === "aspect" ? "aspectRatio" : field;
    const target = t as unknown as Record<string, number>;
    if (!(prop in target)) return false;
    target[prop] = clampInt(value, spec.min, spec.max, spec.label);
  }

  body.set(buildTypeVIITiming(t));
  return true;
}

/** Write one Type X field of entry `n`. */
function writeTypeX(
  payload: Uint8Array, offset: number, stride: number, n: number,
  field: string, value: string | number | boolean,
): boolean {
  const spec = TYPE_X_FIELD[field];
  if (!spec) return false;
  const start = offset + n * stride;
  if (start + stride > payload.length) return false;

  const entry = payload.subarray(start, start + stride);
  const extra = stride - 6;
  const t = parseTypeXTiming(entry, extra);

  if (spec === "bool") {
    const on = toBool(value);
    if (field === "y420") t.supportsY420 = on;
    else {
      if (t.altMinVblank === null) return false;
      t.altMinVblank = on;
    }
  } else {
    const n2 = clampInt(value, spec.min, spec.max, spec.label);
    if ((field === "deltaHBlank" || field === "deltaVBlank") && t.deltaHBlank === null) return false;
    if (field === "refresh" && n2 > 256 && extra === 0) {
      throw new Error("Refresh rates above 256 Hz need a 7-byte descriptor");
    }
    const prop = field === "refresh" ? "refreshHz" : field;
    const target = t as unknown as Record<string, number>;
    if (!(prop in target)) return false;
    target[prop] = n2;
  }

  entry.set(buildTypeXTiming(t, extra));
  return true;
}

// ------------------------------------------------------- raw payload editing

/**
 * Hex editing for blocks we do not decode into fields.
 *
 * ATP Manager has the same fallback ladder — a `HEX_STRING` text field guarded
 * by a byte budget (`ReservedBlockEditor` / `BlockDataEditor` /
 * `VendorSpecificGeneralEditor`) — and it is what stops "this block has no
 * editor" from meaning "this block cannot be changed at all". Length may change;
 * the block's length byte is re-derived by `encodeDataBlock` on the way out.
 */
export function parseHexPayload(value: string | number | boolean, limit: number, what: string): Uint8Array {
  const text = String(value).trim().replace(/[\s:,-]/g, "");
  if (text.length === 0) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(text)) throw new Error(`${what} must be hex digits`);
  if (text.length % 2 !== 0) throw new Error(`${what} needs an even number of hex digits`);

  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.substr(i * 2, 2), 16);
  if (bytes.length > limit) {
    throw new Error(`${what} holds at most ${limit} bytes; got ${bytes.length}`);
  }
  return bytes;
}

/** A CTA data block's payload budget: 31 bytes, less the extended-tag byte. */
const CTA_PAYLOAD_LIMIT = 31;

function applyCtaRawPayload(ext: CtaExtension, rest: string, value: string | number | boolean): boolean {
  // cta{i}.ext{tag} — an extended-tag block we show as one hex blob.
  const extTag = /^ext(\d+)$/.exec(rest);
  if (extTag) {
    const found = findExtendedBlock(ext, Number(extTag[1]));
    if (!found) return false;
    // One byte of the 31 is spent on the extended tag itself.
    found.block.payload = parseHexPayload(value, CTA_PAYLOAD_LIMIT - 1, "Extended block payload");
    return true;
  }

  // cta{i}.tag{n} — a base tag we have no decoder for.
  const unknown = /^tag(\d+)$/.exec(rest);
  if (unknown) {
    const tag = Number(unknown[1]);
    const index = ext.dataBlocks.findIndex((b) => b.kind === "unknown-cta" && b.tag === tag);
    if (index === -1) return false;
    ext.dataBlocks[index] = {
      kind: "unknown-cta", tag,
      payload: parseHexPayload(value, CTA_PAYLOAD_LIMIT, "CTA block payload"),
    };
    return true;
  }

  // cta{i}.vsdb.{OUI}.payload — an OUI we do not model (and Dolby Vision).
  const vsdb = /^vsdb\.([0-9A-F-]+)\.payload$/.exec(rest);
  if (vsdb) {
    const index = ext.dataBlocks.findIndex((b) => {
      const ref = asVendorBlock(b);
      return ref !== null && ouiToString(ref.oui) === vsdb[1];
    });
    if (index === -1) return false;
    const block = ext.dataBlocks[index]!;
    const ref = asVendorBlock(block)!;
    // The 3 OUI bytes come out of the same budget as the payload.
    const bytes = parseHexPayload(value, CTA_PAYLOAD_LIMIT - 3, "Vendor payload");
    ext.dataBlocks[index] = toCtaBlock(ref, bytes);
    return true;
  }

  return false;
}

/**
 * Extended tags whose bare `ext{n}` row is a decoded summary, not a hex dump —
 * Video Capability shows "0x03", YCbCr 4:2:0 Video shows VIC names. Their
 * fields are edited individually, so the summary row stays read-only.
 */
const STRUCTURED_EXT_TAGS = new Set([0, 5, 6, 14, 120]);

export function isRawPayloadPath(path: string): boolean {
  if (/^base\.desc\d+\.raw$/.test(path)) return true;
  if (/^cta\d+\.tag\d+$/.test(path)) return true;
  if (/^cta\d+\.vsdb\.[0-9A-F-]+\.payload$/.test(path)) return true;
  if (/^did\d+\.db\d+\.payload$/.test(path)) return true;

  const ext = /^cta\d+\.ext(\d+)$/.exec(path);
  if (ext) return !STRUCTURED_EXT_TAGS.has(Number(ext[1]));
  return false;
}

// ---------------------------------------------------------------- DisplayID

/** Editable Display Parameters fields; shared by the gate and the router. */
const DID_PARAM_FIELD =
  /^db\d+\.(hSize|vSize|hPixels|vPixels|scan|lumInfo|colorSpace|speaker|colorDepth|tech|gamma|maxLum|maxLum10|minLum|(?:primary[123]|white)[XY])$/;

/** Editable Adaptive-Sync descriptor fields. */
const DID_ASYNC_FIELD =
  /^db\d+\.as\d+\.(minHz|maxHz|modes|seamless|native|sfdIncCode|sfdDecCode)$/;

/**
 * Display Parameters (0x21). Sizes and luminances are stored encoded — image
 * size in mm or 0.1 mm depending on a header flag, luminance as IEEE half
 * floats, gamma as (value*100)-100 — so each is converted on the way in.
 */
function applyDisplayParams(
  block: DisplayIdDataBlock, field: string, value: string | number | boolean,
): boolean {
  let d;
  try { d = parseDisplayParamsV2(block.payload); } catch { return false; }
  const useMultiplier = ((block.revision >> 4) & 1) === 1;

  switch (field) {
    case "hSize": case "vSize": {
      const mm = clampFloat(value, 0, useMultiplier ? 65535 : 6553.5, "Image Size (mm)");
      const raw = Math.round(useMultiplier ? mm : mm * 10);
      if (field === "hSize") d.horizontalImageSizeRaw = raw; else d.verticalImageSizeRaw = raw;
      break;
    }
    case "hPixels": d.horizontalPixelCount = clampInt(value, 0, 65535, "H Pixel Count"); break;
    case "vPixels": d.verticalPixelCount = clampInt(value, 0, 65535, "V Pixel Count"); break;
    case "scan": d.scanOrientation = clampInt(value, 0, 7, "Scan Orientation"); break;
    case "lumInfo": d.luminanceInfo = clampInt(value, 0, 3, "Luminance Info"); break;
    case "colorSpace": d.colorSpaceCie1976 = toBool(value); break;
    case "speaker": d.audioSpeakerNotIntegrated = toBool(value); break;
    case "colorDepth": d.nativeColorDepth = clampInt(value, 0, 7, "Native Color Depth"); break;
    case "tech": d.displayDeviceTechnology = clampInt(value, 0, 7, "Device Technology"); break;
    case "gamma": {
      const text = String(value).trim().toLowerCase();
      // 0xFF is the spec's "not defined", so it needs a way in from the UI.
      d.gammaRaw = text === "not defined" || text === "" ? 0xff
        : clampInt(Math.round(clampFloat(value, 1, 3.55, "Gamma") * 100) - 100, 0, 254, "Gamma");
      break;
    }
    case "maxLum":
      d.maxLuminanceFull = floatToHalf(clampFloat(value, 0, 65504, "Max Luminance")); break;
    case "maxLum10":
      d.maxLuminance10Percent = floatToHalf(clampFloat(value, 0, 65504, "Max Luminance 10%")); break;
    case "minLum":
      d.minLuminance = floatToHalf(clampFloat(value, 0, 65504, "Min Luminance")); break;
    default: {
      const coord = /^(primary[123]|white)([XY])$/.exec(field);
      if (!coord) return false;
      const target = d[coord[1] as "primary1" | "primary2" | "primary3" | "white"];
      const n = clampInt(value, 0, 4095, "Colour coordinate");
      if (coord[2] === "X") target.x = n; else target.y = n;
    }
  }

  const rebuilt = buildDisplayParamsV2(d);
  if (rebuilt.length !== block.payload.length) return false;
  block.payload.set(rebuilt);
  return true;
}

/** Adaptive-Sync (0x2b): one descriptor per supported range. */
function applyAdaptiveSync(
  block: DisplayIdDataBlock, index: number, field: string, value: string | number | boolean,
): boolean {
  let v;
  try { v = parseAdaptiveSync(block.payload); } catch { return false; }
  const a = v.descriptors[index];
  if (!a) return false;

  switch (field) {
    case "minHz": a.minRefreshRateHz = clampInt(value, 0, 255, "Min Refresh Rate"); break;
    case "maxHz": a.maxRefreshRateHz = clampInt(value, 0, 1023, "Max Refresh Rate"); break;
    case "modes": a.supportedModes = clampInt(value, 0, 7, "Supported Modes"); break;
    case "seamless": a.seamlessTransition = toBool(value); break;
    case "native": a.nativePanelRange = toBool(value); break;
    case "sfdIncCode":
      a.maxSingleFrameIncreaseCode = clampInt(value, 0, 63, "Single Frame Increase"); break;
    case "sfdDecCode":
      a.maxSingleFrameDecreaseCode = clampInt(value, 0, 63, "Single Frame Decrease"); break;
    default: return false;
  }

  const rebuilt = buildAdaptiveSync(v);
  if (rebuilt.length !== block.payload.length) return false;
  block.payload.set(rebuilt);
  return true;
}


const EDITABLE_TYPE_I = new Set([
  "clock", "aspect", "interlaced", "preferred", "support3d",
  "hActive", "hBlank", "hSyncOffset", "hSyncPositive", "hSyncWidth",
  "vActive", "vBlank", "vSyncOffset", "vSyncPositive", "vSyncWidth",
]);

function applyDisplayId(ext: DisplayIdExtension, rest: string, value: string | number | boolean): boolean {
  if (rest === "versionMajor") { ext.version = clampInt(value, 0, 15, "DisplayID Version"); return true; }
  if (rest === "versionMinor") { ext.revision = clampInt(value, 0, 15, "DisplayID Revision"); return true; }
  if (rest === "useCase") { ext.productType = clampInt(value, 0, 255, "Primary Use Case"); return true; }

  const timing = /^db(\d+)\.(?:t7\.(.+)|tx(\d+)\.(.+))$/.exec(rest);
  if (timing) {
    const target = ext.dataBlocks[Number(timing[1])];
    if (!target) return false;
    // In the DisplayID carrier the descriptor-size field lives in the revision
    // byte, because tag/revision/length were stripped when the block decoded.
    const extra = (target.revision >> 4) & 0x07;
    if (timing[2] !== undefined) {
      if (target.tag !== DidTag.TimingVII) return false;
      return writeTypeVII(target.payload, 0, extra, timing[2], value);
    }
    if (target.tag !== DidTag.TimingX) return false;
    return writeTypeX(target.payload, 0, TYPE_X_BASE_LENGTH + extra, Number(timing[3]), timing[4]!, value);
  }

  const t8 = /^db(\d+)\.t8\.(.+)$/.exec(rest);
  if (t8) {
    const target = ext.dataBlocks[Number(t8[1])];
    if (!target || target.tag !== DidTag.TimingVIII) return false;
    // Here the revision byte is the options byte, so an option edit rewrites it.
    const next = applyTypeVIII(t8[2]!, value, "displayid", target.revision, target.payload);
    if (!next) return false;
    target.revision = next.options;
    target.payload = next.payload;
    return true;
  }

  const drl = /^db(\d+)\.(minClock|maxClock|minRefresh|maxRefresh|seamless)$/.exec(rest);
  if (drl) {
    const target = ext.dataBlocks[Number(drl[1])];
    if (!target || target.tag !== DidTag.DynamicRangeLimits) return false;
    return applyDynamicRangeLimits(target.payload, drl[2]!, value);
  }

  const params = DID_PARAM_FIELD.test(rest) ? /^db(\d+)\.(.+)$/.exec(rest) : null;
  if (params) {
    const target = ext.dataBlocks[Number(params[1])];
    if (!target || target.tag !== DidTag.DisplayParamsV2) return false;
    return applyDisplayParams(target, params[2]!, value);
  }

  const async = DID_ASYNC_FIELD.test(rest) ? /^db(\d+)\.as(\d+)\.(.+)$/.exec(rest) : null;
  if (async) {
    const target = ext.dataBlocks[Number(async[1])];
    if (!target || target.tag !== DidTag.AdaptiveSync) return false;
    return applyAdaptiveSync(target, Number(async[2]), async[3]!, value);
  }

  const text = /^db(\d+)\.text$/.exec(rest);
  if (text) {
    const target = ext.dataBlocks[Number(text[1])];
    if (!target) return false;
    if (target.tag !== DidTag.ProductSerialNumber && target.tag !== DidTag.AsciiString) return false;
    const chars = String(value).slice(0, target.payload.length);
    // Keep the block length fixed and pad with spaces, as the spec requires.
    target.payload.fill(0x20);
    for (let i = 0; i < chars.length; i++) target.payload[i] = chars.charCodeAt(i) & 0x7f;
    return true;
  }

  const rawPayload = /^db(\d+)\.payload$/.exec(rest);
  if (rawPayload) {
    const target = ext.dataBlocks[Number(rawPayload[1])];
    if (!target) return false;
    // A DisplayID section is 121 bytes at most, minus this block's 3-byte header.
    target.payload = parseHexPayload(value, 118, "DisplayID block payload");
    return true;
  }

  const m = /^db(\d+)\.(.+)$/.exec(rest);
  if (!m) return false;
  const db = ext.dataBlocks[Number(m[1])];
  if (!db || db.tag !== DidTag.TimingI) return false;

  const field = m[2]!;
  if (!EDITABLE_TYPE_I.has(field)) return false;

  let t;
  try { t = parseTypeITiming(db.payload); } catch { return false; }

  switch (field) {
    case "clock":        t.pixelClockMhz = clampFloat(value, 0.01, 655.36, "Pixel Clock"); break;
    case "aspect":        t.aspectRatio = clampInt(value, 0, 8, "Aspect Ratio"); break;
    case "interlaced":    t.interlaced = toBool(value); break;
    case "preferred":     t.preferred = toBool(value); break;
    case "support3d":     t.support3d = clampInt(value, 0, 3, "3D Support"); break;
    case "hActive":       t.hActive = clampInt(value, 1, 65536, "H Active"); break;
    case "hBlank":        t.hBlank = clampInt(value, 1, 65536, "H Blank"); break;
    case "hSyncOffset":   t.hSyncOffset = clampInt(value, 1, 32768, "H Sync Offset"); break;
    case "hSyncPositive": t.hSyncPositive = toBool(value); break;
    case "hSyncWidth":    t.hSyncWidth = clampInt(value, 1, 65536, "H Sync Width"); break;
    case "vActive":       t.vActive = clampInt(value, 1, 65536, "V Active"); break;
    case "vBlank":        t.vBlank = clampInt(value, 1, 65536, "V Blank"); break;
    case "vSyncOffset":   t.vSyncOffset = clampInt(value, 1, 32768, "V Sync Offset"); break;
    case "vSyncPositive": t.vSyncPositive = toBool(value); break;
    case "vSyncWidth":    t.vSyncWidth = clampInt(value, 1, 65536, "V Sync Width"); break;
    default: return false;
  }

  db.payload = buildTypeITiming(t);
  return true;
}

// ------------------------------------------------------------------ helpers

function clampInt(value: string | number | boolean, min: number, max: number, label: string): number {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  const i = Math.round(n);
  if (i < min || i > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return i;
}

function clampFloat(value: string | number | boolean, min: number, max: number, label: string): number {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return n;
}

function toBool(value: string | number | boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off", ""].includes(s)) return false;
  throw new Error(`Cannot read "${value}" as true/false`);
}
