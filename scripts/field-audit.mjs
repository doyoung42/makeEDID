#!/usr/bin/env node
/**
 * Full-coverage field audit.
 *
 * Answers one question for every field of every block: **can a user actually
 * change this, and does the change survive a save?** Each editable field is
 * edited, re-encoded, re-decoded and read back, so a field only counts as
 * verified when the new value is still there after a full round-trip through
 * the bytes — not merely when `applyField` returned true.
 *
 * Two populations are swept, because neither alone is complete:
 *
 *   - the real corpus, which has the block mixtures shipping monitors use but
 *     contains zero Dolby Vision and zero Type VIII blocks;
 *   - a synthetic file assembled from the whole structure catalogue, which
 *     reaches those but is not evidence about real hardware.
 *
 * Exits non-zero when a read-only field has no stated reason. That is the
 * check that keeps "why can't I edit this?" from being answered by silence.
 *
 *   node scripts/field-audit.mjs [--verbose]
 */
import { decodeEdid, encodeEdid } from "../packages/edid-core/dist/index.js";
import { flattenEdid } from "../packages/edid-core/dist/flatten.js";
import { applyField, isFieldEditable } from "../packages/edid-core/dist/applyField.js";
import { readOnlyReason, describeInput } from "../packages/edid-core/dist/inputs.js";
import { createBlankEdid } from "../packages/edid-core/dist/template.js";
import {
  addExtension, addCtaBlock, addCtaDtd, addDisplayIdBlock, setDescriptorKind,
  ctaBlockCatalogue, displayIdBlockCatalogue,
} from "../packages/edid-core/dist/structure.js";
import { findDdcFiles, loadDdc, CORPUS_ROOT } from "../test/corpus/loader.mjs";

const verbose = process.argv.includes("--verbose");
const shape = (p) => p.replace(/\d+/g, "#");

/** One file carrying every block the catalogue can build. */
function maximalEdid() {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  let cta = 0;
  for (const spec of ctaBlockCatalogue()) {
    try {
      addCtaBlock(edid, cta, spec.id);
    } catch {
      addExtension(edid, "cta");
      cta = edid.extensions.length - 1;
      addCtaBlock(edid, cta, spec.id);
    }
  }
  // The last extension is usually full by now, so give the DTD its own block.
  try {
    addCtaDtd(edid, cta);
  } catch {
    addExtension(edid, "cta");
    addCtaDtd(edid, edid.extensions.length - 1);
  }
  addExtension(edid, "displayid");
  let did = edid.extensions.length - 1;
  for (const spec of displayIdBlockCatalogue()) {
    try {
      addDisplayIdBlock(edid, did, spec.tag);
    } catch {
      addExtension(edid, "displayid");
      did = edid.extensions.length - 1;
      addDisplayIdBlock(edid, did, spec.tag);
    }
  }
  setDescriptorKind(edid, 3, "detailed-timing");
  return edid;
}

/**
 * Fields whose storage unit is coarser than the value shown, with that unit.
 * Nudging one of these by 1 rounds straight back, which would look like a
 * failed write when it is only quantisation — so they are stepped by a whole
 * unit and then verified like everything else, rather than excused.
 */
const QUANTUM = [
  [/\.dtd\d*\.clock$|\.dtd\.clock$/, 10],       // DTD pixel clock: 10 kHz units
  [/^base\.desc\d+\.maxClock$/, 10],            // range limits: 10 MHz units
  [/\.maxTmds$/, 5],                            // Max_TMDS: 5 MHz units
];

/**
 * A value different from the current one that the field could plausibly take.
 *
 * The affordance registry is consulted first, so a dropdown is exercised with a
 * real option and a bounded number with a value inside its range. That also
 * cross-checks `describeInput` against the writer: if the registry offers a
 * value the writer refuses, this sweep is where it shows up.
 */
function perturb(field) {
  const v = field.value;
  if (typeof v === "boolean") return !v;

  const input = describeInput(field.path, field.kind);

  if (input?.control === "select") {
    const other = input.options.find((o) => String(o.value) !== String(v));
    return other ? other.value : null;
  }

  if (typeof v === "number") {
    const q = QUANTUM.find(([re]) => re.test(field.path));
    if (q) return v > q[1] ? v - q[1] : v + q[1];
    if ((input?.control === "number" || input?.control === "coded")
      && input.min !== undefined && input.max !== undefined) {
      // Stay inside the declared range, which a blind -1 often leaves.
      return v > input.min ? v - 1 : Math.min(v + 1, input.max);
    }
    return Number.isInteger(v) && v > 0 ? v - 1 : v + 1;
  }

  if (typeof v === "string") {
    if (input?.control === "text") {
      const base = v.trim();
      // Same length, different content: length limits are field-specific and a
      // longer string would be testing truncation rather than the write path.
      if (base.length === 0) return null;
      const flipped = (base[0] === "A" ? "B" : "A") + base.slice(1);
      return flipped.slice(0, input.maxLength);
    }
    const hex = v.replace(/^0x/i, "");
    if (/^[0-9A-Fa-f]+$/.test(hex) && hex.length % 2 === 0) return hex;
    return null;
  }
  return null;
}

function checksumsValid(bytes) {
  for (let b = 0; b < bytes.length; b += 128) {
    let s = 0;
    for (let i = 0; i < 128; i++) s += bytes[b + i];
    if (s % 256 !== 0) return false;
  }
  return true;
}

/** Which block a field belongs to, for the coverage table. */
function blockOf(path) {
  if (path.startsWith("base.")) return "Base EDID";
  if (path.startsWith("block")) return "Block header";
  const cta = /^cta\d+\.(.+)$/.exec(path);
  if (cta) {
    const rest = cta[1];
    if (rest.startsWith("vsdb.")) return "CTA · " + (rest.split(".")[1] ?? "vendor");
    if (rest.startsWith("sad") || rest.startsWith("adb") || rest.startsWith("speaker")) return "CTA · Audio";
    if (rest.startsWith("svd") || rest.startsWith("vdb")) return "CTA · Video";
    if (rest.startsWith("dtd")) return "CTA · Detailed Timing";
    const ext = /^ext(\d+)/.exec(rest);
    if (ext) return "CTA · ext 0x" + Number(ext[1]).toString(16);
    return "CTA · header";
  }
  const did = /^did\d+\.db\d+/.exec(path);
  if (did) return "DisplayID · data block";
  if (path.startsWith("did")) return "DisplayID · header";
  return "other";
}

const stats = new Map();
function bucket(name) {
  if (!stats.has(name)) {
    stats.set(name, { fields: new Set(), editable: new Set(), verified: new Set(), readOnly: new Set() });
  }
  return stats.get(name);
}

const problems = [];
const unexplained = new Set();
const notVerified = new Map();

/** Sweep one model: try every field and record what happened. */
function sweep(label, template, bytesOf) {
  const fields = flattenEdid(template, bytesOf);
  for (const f of fields) {
    if (f.role !== "field") continue;
    const b = bucket(blockOf(f.path));
    const key = shape(f.path);
    b.fields.add(key);

    if (!isFieldEditable(f.path)) {
      b.readOnly.add(key);
      if (!readOnlyReason(f.path)) unexplained.add(key);
      continue;
    }
    b.editable.add(key);
    if (b.verified.has(key)) continue;

    const next = perturb(f);
    if (next === null) continue;

    // Work on a fresh copy so one field's edit cannot mask another's.
    let edid;
    try { edid = decodeEdid(bytesOf); } catch { continue; }

    let applied = false;
    try {
      applied = applyField(edid, f.path, next);
    } catch {
      continue;   // the writer rejected this value; the field still has a writer
    }
    if (!applied) {
      problems.push(`${label} ${f.path}: editable per the gate, but applyField refused`);
      continue;
    }

    let after;
    try { after = encodeEdid(edid); } catch (e) {
      problems.push(`${label} ${f.path}: no longer encodes (${e.message})`);
      continue;
    }
    if (!checksumsValid(after)) {
      problems.push(`${label} ${f.path}: produced an invalid checksum`);
      continue;
    }

    // The real test: is the value still there after a save and a reload?
    const reread = flattenEdid(decodeEdid(after)).find((x) => x.path === f.path);
    if (!reread) {
      notVerified.set(key, "the row disappeared after the edit");
      continue;
    }
    // Hex rows differ only in whether they carry an "0x" prefix.
    const norm = (x) => String(x).replace(/^0x/i, "").toLowerCase();
    if (norm(reread.value) !== norm(next)) {
      notVerified.set(key, `wrote ${JSON.stringify(next)}, read back ${JSON.stringify(reread.value)}`);
      continue;
    }
    b.verified.add(key);
  }
}

// ---------------------------------------------------------------- populations

const synthetic = maximalEdid();
sweep("synthetic", synthetic, encodeEdid(synthetic));

let corpusFiles = [];
try { corpusFiles = findDdcFiles(process.env.EDID_CORPUS_ROOT ?? CORPUS_ROOT); } catch { /* absent */ }

let swept = 0;
for (const file of corpusFiles) {
  let bytes;
  try { bytes = loadDdc(file).bytes; } catch { continue; }
  let template;
  try { template = decodeEdid(bytes); } catch { continue; }

  // Only sweep files that add coverage; the corpus repeats models heavily.
  const adds = flattenEdid(template).some(
    (f) => f.role === "field" && isFieldEditable(f.path)
      && !bucket(blockOf(f.path)).verified.has(shape(f.path)));
  if (!adds) continue;

  sweep(file, template, bytes);
  swept++;
}

// --------------------------------------------------------------------- report

const rows = [...stats].sort((a, b) => a[0].localeCompare(b[0]));
const width = Math.max(24, ...rows.map(([name]) => name.length));
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log("\nEDID Workbench — field coverage audit");
console.log(`synthetic maximal file + ${swept} corpus file(s) of ${corpusFiles.length}\n`);
console.log(pad("Block", width) + num("fields", 8) + num("editable", 10)
  + num("verified", 10) + num("read-only", 11));
console.log("-".repeat(width + 39));

let tf = 0, te = 0, tv = 0, tr = 0;
for (const [name, s] of rows) {
  console.log(pad(name, width) + num(s.fields.size, 8) + num(s.editable.size, 10)
    + num(s.verified.size, 10) + num(s.readOnly.size, 11));
  tf += s.fields.size; te += s.editable.size; tv += s.verified.size; tr += s.readOnly.size;
}
console.log("-".repeat(width + 39));
console.log(pad("TOTAL", width) + num(tf, 8) + num(te, 10) + num(tv, 10) + num(tr, 11));

console.log("\n\"verified\" means the edit survived encode -> decode and read back the value written.");

// Editable, but the sweep never managed to exercise it — usually a free-text
// field with no safe automatic value. Naming them keeps the gap visible instead
// of hiding inside the difference between two totals.
const unexercised = [];
for (const [name, s] of rows) {
  for (const key of s.editable) {
    if (!s.verified.has(key)) unexercised.push(name + " · " + key);
  }
}
if (unexercised.length > 0) {
  console.log(`\n${unexercised.length} editable field shape(s) the sweep could not exercise`
    + " (no safe automatic value — check these by hand):");
  for (const u of unexercised.slice(0, verbose ? 999 : 20)) console.log("  " + u);
}

if (notVerified.size > 0) {
  console.log(`\n${notVerified.size} editable field shape(s) accepted an edit but did not read back:`);
  for (const [key, why] of [...notVerified].slice(0, verbose ? 999 : 15)) {
    console.log(`  ${pad(key, 44)} ${why}`);
  }
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, verbose ? 999 : 15)) console.log("  " + p);
}

if (unexplained.size > 0) {
  console.log(`\nFAIL: ${unexplained.size} read-only field shape(s) with no stated reason:`);
  for (const key of [...unexplained].sort()) console.log("  " + key);
  console.log("\nEvery read-only field must explain itself in inputs.ts `READ_ONLY_REASONS`,");
  console.log("or the UI shows a locked cell that looks like a missing feature.");
  process.exit(1);
}

console.log("\nOK — every read-only field states why.");
