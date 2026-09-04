import type { SpecField } from "./flatten.js";
import { AUDIO_FORMAT, STD_ASPECT_LABEL, SCAN_INFO } from "./flatten.js";
import {
  ASPECT_RATIO_LABEL, SUPPORT_3D_LABEL, TIMING_FORMULA_LABEL, TIMING_CODE_TYPE_LABEL,
} from "./displayidTiming.js";
import { MAX_FRL_RATE_LABELS } from "./vsdb/hdmiForum.js";

/**
 * What control a field should be edited with.
 *
 * `flatten.ts` says what a field *is* (`kind`); this says how to *type into it*.
 * They are deliberately separate: `kind` has ~180 call sites and describes the
 * data, while an affordance is a UI decision that changes more often.
 *
 * The values committed are always **raw codes**, never labels. A dropdown shows
 * "4 — 16:9" but commits `4`. Breaking that rule has broken the round-trip
 * tests twice (see `packages/edid-core/CLAUDE.md`).
 */
export type FieldInput =
  | { control: "text"; maxLength: number }
  /** `min`/`max` are omitted when the accepted range is not independently known. */
  | { control: "number"; min?: number; max?: number; unit?: string }
  | { control: "select"; options: { value: number; label: string }[] }
  | { control: "hex"; bytes: number | null }
  /** A raw code plus a read-out of what it means physically. */
  | { control: "coded"; min: number; max: number; unit: string }
  /** One row holds a whole list; `example` is the format hint. */
  | { control: "list"; example: string }
  /** A group row's count cell; stepping it adds or removes entries. */
  | { control: "count"; min: number; max: number; itemLabel: string }
  | { control: "boolean" };

type Options = { value: number; label: string }[];

const fromArray = (labels: readonly string[]): Options =>
  labels.map((label, value) => ({ value, label }));

const fromRecord = (map: Record<number, string>): Options =>
  Object.entries(map).map(([value, label]) => ({ value: Number(value), label }));

/** EDID 1.4 base block, byte 20 bits 6:4 — 0 means "undefined". */
const BIT_DEPTH: Options = [
  { value: 0, label: "Undefined" }, { value: 6, label: "6 bpc" }, { value: 8, label: "8 bpc" },
  { value: 10, label: "10 bpc" }, { value: 12, label: "12 bpc" }, { value: 14, label: "14 bpc" },
  { value: 16, label: "16 bpc" },
];

/** EDID 1.4 base block, byte 20 bits 3:0. */
const VIDEO_INTERFACE: Options = [
  { value: 0, label: "Undefined" }, { value: 1, label: "DVI" }, { value: 2, label: "HDMI-a" },
  { value: 3, label: "HDMI-b" }, { value: 4, label: "MDDI" }, { value: 5, label: "DisplayPort" },
];

const SYNC_TYPE = fromArray([
  "Analog composite", "Bipolar analog composite", "Digital composite", "Digital separate",
]);

const STEREO = fromArray([
  "None", "None (reserved)", "Field sequential, right on sync high",
  "2-way interleaved, right on even", "Field sequential, left on sync high",
  "2-way interleaved, left on even", "4-way interleaved", "Side-by-side interleaved",
]);

const COLOR_TYPE = fromArray([
  "Monochrome / grayscale", "RGB colour", "Non-RGB colour", "Undefined",
]);

/** Display Range Limits byte 10. */
const TIMING_SUPPORT = fromArray([
  "Default GTF", "Range limits only", "Secondary GTF", "CVT",
]);

/** HDMI 1.4b image size interpretation. */
const IMAGE_SIZE = fromArray([
  "No additional information", "Aspect ratio", "Size in units of 1 cm", "Size in units of 5 cm",
]);

/**
 * Path shape → control. Order matters: the first match wins, so specific
 * suffixes must precede the generic fallbacks at the bottom.
 */
const RULES: [RegExp, FieldInput][] = [
  // ---- enumerations -------------------------------------------------------
  [/\.dtd\.syncType$|\.dtd\d*\.syncType$|\bsyncType$/, { control: "select", options: SYNC_TYPE }],
  [/\bstereo$/, { control: "select", options: STEREO }],
  [/\bsyncFlags$/, { control: "number", min: 0, max: 3 }],
  [/^base\.features\.colorType$/, { control: "select", options: COLOR_TYPE }],
  [/^base\.input\.bitDepth$/, { control: "select", options: BIT_DEPTH }],
  [/^base\.input\.interface$/, { control: "select", options: VIDEO_INTERFACE }],
  [/^base\.desc\d+\.timingSupport$/, { control: "select", options: TIMING_SUPPORT }],
  [/^base\.std\d+\.aspect$/, { control: "select", options: fromArray(STD_ASPECT_LABEL) }],
  [/\.(spt|sit|sce)$/, { control: "select", options: fromArray(SCAN_INFO) }],
  [/\.sad\d+\.format$/, { control: "select", options: fromRecord(AUDIO_FORMAT) }],
  [/\.imageSize$/, { control: "select", options: IMAGE_SIZE }],
  [/\.(dscMaxFrl|maxFrl)$/, { control: "select", options: fromArray(MAX_FRL_RATE_LABELS) }],
  [/\.aspect$/, { control: "select", options: fromArray(ASPECT_RATIO_LABEL) }],
  [/\.support3d$/, { control: "select", options: fromArray(SUPPORT_3D_LABEL) }],
  [/\.algorithm$/, { control: "select", options: fromArray(TIMING_FORMULA_LABEL) }],
  [/\.t8\.codeType$/, { control: "select", options: fromArray(TIMING_CODE_TYPE_LABEL) }],

  // ---- lists --------------------------------------------------------------
  [/\.svd\.vics$/, { control: "list", example: "16*, 31, 4  (* marks the native VIC)" }],
  [/\.hdmiVics$/, { control: "list", example: "3840x2160p @ 30 Hz, 4096x2160p @ 24 Hz" }],
  [/\.t8\.codes$/, { control: "list", example: "4, 9, 16, 32" }],
  [/\.phyAddr$/, { control: "text", maxLength: 7 }],

  // ---- text ---------------------------------------------------------------
  [/^base\.manufacturer$/, { control: "text", maxLength: 3 }],
  [/^base\.desc\d+\.(name|serial|text)$/, { control: "text", maxLength: 13 }],

  // ---- coded: a raw code whose physical meaning is non-linear -------------
  [/\.minLum1$/, { control: "coded", min: 0, max: 255, unit: "cd/m²" }],
  [/\.(maxLum|avgLum|minLum)$/, { control: "coded", min: 0, max: 255, unit: "cd/m²" }],
  [/^base\.chroma\.(red|green|blue|white)[XY]$/, { control: "coded", min: 0, max: 1023, unit: "CIE" }],

  // ---- numbers with a range we can state independently --------------------
  [/^base\.productCode$/, { control: "number", min: 0, max: 0xffff }],
  [/^base\.serialNumber$/, { control: "number", min: 0, max: 0xffffffff }],
  [/^base\.week$/, { control: "number", min: 0, max: 54 }],
  [/^base\.year$/, { control: "number", min: 1990, max: 2245 }],
  [/^base\.(hSizeCm|vSizeCm)$/, { control: "number", min: 0, max: 255, unit: "cm" }],
  [/^base\.edidVersionMajor$/, { control: "number", min: 1, max: 255 }],
  [/^base\.edidRevision$/, { control: "number", min: 0, max: 255 }],
  [/^base\.std\d+\.hActive$/, { control: "number", min: 256, max: 2288, unit: "px" }],
  [/^base\.std\d+\.refresh$/, { control: "number", min: 60, max: 123, unit: "Hz" }],
  [/^base\.desc\d+\.maxClock$/, { control: "number", min: 0, max: 2550, unit: "MHz" }],
  [/\.t8\.revision$/, { control: "number", min: 0, max: 7 }],
  [/\.t8\.codeSize$/, { control: "number", min: 1, max: 2, unit: "bytes" }],
  [/\.(minClock|maxClock)$/, { control: "number", min: 1, max: 0x1000000, unit: "kHz" }],
  [/\.(minRefresh|maxRefresh)$/, { control: "number", min: 0, max: 255, unit: "Hz" }],

  // ---- raw payloads -------------------------------------------------------
  [/\.sad\d+\.byte3$/, { control: "hex", bytes: 1 }],
  [/\.payload$|^cta\d+\.ext\d+$|^cta\d+\.tag\d+$|^base\.desc\d+\.raw$/, { control: "hex", bytes: null }],
];

/**
 * The affordance for one field, or `null` when the field is not editable at all.
 *
 * `kind` comes from the same `SpecField` the UI is rendering; it decides the
 * fallback when no rule matches, so a newly wired field still gets a usable
 * control instead of nothing.
 */
export function describeInput(path: string, kind?: SpecField["kind"]): FieldInput | null {
  for (const [pattern, input] of RULES) {
    if (pattern.test(path)) return input;
  }
  switch (kind) {
    case "boolean": return { control: "boolean" };
    case "hex": return { control: "hex", bytes: null };
    case "number": return { control: "number" };
    case "enum": return { control: "number" };
    case "string": return { control: "text", maxLength: 128 };
    default: return null;
  }
}

/** Count cells for the group rows whose lists `setListCount` can resize. */
export function describeCount(path: string): FieldInput | null {
  if (/^cta\d+\.adb$/.test(path)) return { control: "count", min: 0, max: 10, itemLabel: "SAD" };
  if (/^cta\d+\.vdb$/.test(path)) return { control: "count", min: 0, max: 31, itemLabel: "SVD" };
  if (/^cta\d+\.dtds$/.test(path)) return { control: "count", min: 0, max: 6, itemLabel: "DTD" };
  return null;
}

/**
 * Why a field cannot be edited.
 *
 * Every read-only row must be able to answer this. The UI shows it as the
 * cell's tooltip and `scripts/field-audit.mjs` fails when any read-only field
 * has no reason — so "why can't I change this?" always has an answer on screen
 * rather than looking like a missing feature.
 */
const READ_ONLY_REASONS: [RegExp, string][] = [
  [/\.checksum$/,
    "Recomputed on save. This is the one value the tool always re-derives, because the tool it replaces got it wrong."],
  [/^base\.extensionCount$/,
    "Derived from the number of extension blocks. When an HF-EEODB is present it governs the count instead, so byte 126 is left alone."],
  [/^base\.edidVersion$|^did\d+\.version$/,
    "A display of the major and minor fields below — edit those."],
  [/^base\.chroma\.(red|green|blue|white)$/,
    "A display of the X and Y coordinates below — edit those."],
  [/^base\.desc\d+\.dtd$/,
    "A summary of the timing fields below — edit those."],
  [/^base\.desc\d+\.(hRange|vRange)$/,
    "A summary of the min and max fields below — edit those."],
  [/^base\.input\.kind$/,
    "Digital and analog inputs have completely different byte layouts, so switching between them is a structural change rather than a field edit."],
  [/\.eotf$/,
    "A summary of the individual EOTF flags below — edit those."],
  [/\.t7m$|\.txm$|\.t8opt$/,
    "The block's descriptor-size knob. It is derived from the entries, which are edited individually."],
  [/^cta\d+\.revision$/,
    "Protected. Below revision 3 the encoder drops the entire data block collection, so changing this would silently delete every block."],
  [/\.(sad|svd)\.count$|^did\d+\.blockCount$/,
    "Derived from the list. Use the count stepper on the group row to add or remove entries."],
  [/^cta\d+\.speakerAlloc$/,
    "A display of the speaker flags below — edit those."],
  [/^cta\d+\.svd$/,
    "A display of the SVD list. Edit the list row instead."],
  [/\.minLum\d$/,
    "Computed from a raw code by a formula with no clean inverse. Edit the matching “Code” field instead — this row shows what the code means."],
  [/^cta\d+\.ext\d+$/,
    "This block is decoded into individual fields, listed below. Editing the raw payload here would fight with them, so only undecoded blocks expose a hex row."],
  [/^did\d+\.db\d+\.(primary[123]|white)$/,
    "A display of the x and y coordinate codes below \u2014 edit those."],
  [/^did\d+\.db\d+\.as\d+\.range$/,
    "A display of the min and max refresh rates below \u2014 edit those."],
  [/^did\d+\.db\d+\.as\d+\.sfd(Inc|Dec)$/,
    "A percentage derived from a code. Edit the matching \u201cCode\u201d field instead."],
  [/^did\d+\.db\d+\.(grid|loc|size|bezel)$/,
    "Tiled Display Topology is not decoded into individual fields yet. Its bytes are reachable through the block payload."],
  [/^did\d+\.db\d+\.uuid$/,
    "A 16-byte container identifier shown as a UUID. Edit it through the block payload."],
  [/\.t7\.count$|\.tx\d*\.count$|\.t\d+\.count$/,
    "Derived from the payload length. A timing block stores as many entries as fit, so the count follows the entries."],
  [/^cta\d+\.ext\d+\.all$/,
    "Set when the capability map is empty, which the spec defines as \u201cevery SVD supports 4:2:0\u201d. Add or remove per-SVD bits to change it."],
  [/^cta\d+\.vsdb\.[0-9A-F-]+\.variant$/,
    "Identified from the version field and the payload length together, so it changes when those do rather than on its own."],
  [/^did\d+\.db\d+\.tag$/,
    "A DisplayID block's tag is its identity. Remove the block and add the one you want instead."],
];

export function readOnlyReason(path: string): string | null {
  for (const [pattern, reason] of READ_ONLY_REASONS) {
    if (pattern.test(path)) return reason;
  }
  return null;
}
