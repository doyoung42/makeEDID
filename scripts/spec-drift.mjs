#!/usr/bin/env node
/**
 * Spec drift report.
 *
 * Answers one question: "a spec document changed — which of our fields might be
 * affected?" It never edits code. The reference Python platform tried to close
 * this loop with codegen and produced 293 stub classes that all raise
 * NotImplementedError and were never integrated; the lesson taken here is that
 * LLM-extracted field records are good enough to *flag* work, not to generate a
 * decoder (they carry offsets and bit ranges but no scale factors at all).
 *
 * Usage:
 *   node scripts/spec-drift.mjs              # report to stdout
 *   node scripts/spec-drift.mjs --write      # also refresh the baseline
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SPEC_PDF_DIR = "reference/specs/pdf";
const ANSWERS_DIR = "reference/specs/extracted/answers";
const FIELD_MAP = "packages/edid-core/spec/field-map.json";
const BASELINE = "packages/edid-core/spec/drift-baseline.json";

const write = process.argv.includes("--write");

function loadJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// ------------------------------------------------------- spec document state

function documentStatus() {
  const registry = (loadJson(join(SPEC_PDF_DIR, "registry.json"), []) ?? [])
    .filter((e) => e && e.stem);

  /*
   * Our own baseline is the authority once established. The inherited
   * doc_state.json disagrees with every PDF on disk — that drift predates this
   * repo and is recorded in reference/PROVENANCE.md — so trusting it would make
   * the report cry wolf on all 40 documents forever.
   */
  const ours = loadJson(BASELINE, null)?.docs;
  const state = ours
    ? Object.fromEntries(Object.entries(ours).map(([k, v]) => [k, { pdf_sha256: v }]))
    : (loadJson(join(SPEC_PDF_DIR, "doc_state.json"), { docs: {} })?.docs ?? {});
  const source = ours ? "spec/drift-baseline.json" : "inherited doc_state.json";

  const rows = [];
  for (const entry of registry) {
    const pdf = join(SPEC_PDF_DIR, entry.filename);
    if (!existsSync(pdf)) {
      rows.push({ ...entry, status: "missing", detail: "PDF not present" });
      continue;
    }
    const actual = sha256(pdf);
    const recorded = state[entry.stem]?.pdf_sha256;
    if (!recorded) rows.push({ ...entry, status: "new", detail: "not yet processed", sha: actual });
    else if (recorded !== actual) {
      rows.push({ ...entry, status: "changed", detail: `${recorded.slice(0, 12)} -> ${actual.slice(0, 12)}`, sha: actual });
    } else rows.push({ ...entry, status: "unchanged", sha: actual });
  }

  // PDFs sitting in the folder that nobody registered.
  const registered = new Set(registry.map((e) => e.filename));
  const unregistered = existsSync(SPEC_PDF_DIR)
    ? readdirSync(SPEC_PDF_DIR).filter((f) => f.toLowerCase().endsWith(".pdf") && !registered.has(f))
    : [];

  return { rows, unregistered, source };
}

// --------------------------------------------------- extracted field records

/** Field records the LLM pipeline pulled out of the PDFs, indexed by stem. */
function extractedFields() {
  if (!existsSync(ANSWERS_DIR)) return { byStem: new Map(), total: 0, withOffset: 0 };
  const byStem = new Map();
  let total = 0;
  let withOffset = 0;

  for (const file of readdirSync(ANSWERS_DIR).filter((f) => f.endsWith(".json"))) {
    // Answers are named "<stem>_partN.json".
    const stem = file.replace(/_part\d+\.json$/, "").replace(/\.json$/, "");
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(ANSWERS_DIR, file), "utf8"));
    } catch {
      continue;
    }
    for (const block of doc?.blocks ?? []) {
      for (const f of block?.fields ?? []) {
        total++;
        if (typeof f.byte_offset === "number") withOffset++;
        if (!byStem.has(stem)) byStem.set(stem, []);
        byStem.get(stem).push({
          block: block.block_type ?? block.title ?? "",
          name: f.field_name ?? "",
          byteOffset: f.byte_offset ?? null,
          bits: f.bits ?? "",
        });
      }
    }
  }
  return { byStem, total, withOffset };
}

// ------------------------------------------------------------------- report

const { rows, unregistered, source } = documentStatus();
const extracted = extractedFields();
const map = loadJson(FIELD_MAP);
const fields = map?.fields ?? [];
const baseline = loadJson(BASELINE, { docs: {} });

const changed = rows.filter((r) => r.status === "changed" || r.status === "new" || r.status === "missing");
const bySpec = new Map();
for (const f of fields) {
  if (!f.specDoc) continue;
  if (!bySpec.has(f.specDoc)) bySpec.set(f.specDoc, []);
  bySpec.get(f.specDoc).push(f);
}

const out = [];
out.push("# Spec drift report");
out.push("");
out.push(`Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} · comparing against ${source}`);
out.push("");

out.push("## Spec documents");
out.push("");
out.push(`${rows.length} registered · ${rows.filter((r) => r.status === "unchanged").length} unchanged · ` +
  `${rows.filter((r) => r.status === "changed").length} changed · ` +
  `${rows.filter((r) => r.status === "new").length} new · ` +
  `${rows.filter((r) => r.status === "missing").length} missing`);
out.push("");

// The PDFs are licensed per-seat and stay out of the repository, so a fresh
// clone has nothing to compare against. Say so rather than reporting a clean
// bill of health.
if (!existsSync(SPEC_PDF_DIR)) {
  out.push(`> \`${SPEC_PDF_DIR}\` is not present, so no document could be checked. ` +
    "The standard PDFs are not distributed with this repository — see NOTICE.md.");
  out.push("");
}

if (changed.length === 0) {
  out.push("No document has changed since the recorded state. Nothing to review.");
} else {
  out.push("| status | document | stem | detail |");
  out.push("|---|---|---|---|");
  for (const r of changed) {
    out.push(`| **${r.status}** | ${r.doc_name} | \`${r.stem}\` | ${r.detail} |`);
  }
}
out.push("");

if (unregistered.length) {
  out.push(`### Unregistered PDFs (${unregistered.length})`);
  out.push("");
  out.push("Present in the folder but absent from `registry.json`, so the pipeline ignores them:");
  out.push("");
  for (const f of unregistered) out.push(`- ${f}`);
  out.push("");
}

// ------------------------------------------------- affected implementation

out.push("## Fields to review");
out.push("");
if (changed.length === 0) {
  out.push("None — no spec document moved.");
} else {
  let any = false;
  for (const r of changed) {
    const affected = bySpec.get(r.stem) ?? [];
    const records = extracted.byStem.get(r.stem) ?? [];
    out.push(`### ${r.doc_name} (\`${r.stem}\`) — ${r.status}`);
    out.push("");
    out.push(`${affected.length} implemented field(s) cite this document; ` +
      `${records.length} extracted field record(s) exist for it.`);
    out.push("");
    if (affected.length) {
      any = true;
      out.push("| field path | label | source | editable |");
      out.push("|---|---|---|---|");
      for (const f of affected) {
        out.push(`| \`${f.path}\` | ${f.label} | ${f.sourceKind} | ${f.editable ? "yes" : "no"} |`);
      }
      out.push("");
    }
  }
  if (!any) out.push("No implemented field cites any of the changed documents.");
}
out.push("");

// --------------------------------------------------------------- provenance

out.push("## Implementation provenance");
out.push("");
const byKind = {};
for (const f of fields) byKind[f.sourceKind] = (byKind[f.sourceKind] ?? 0) + 1;
out.push(`${fields.length} field(s) mapped · ${fields.filter((f) => f.editable).length} editable`);
out.push("");
out.push("| sourceKind | fields | meaning |");
out.push("|---|---|---|");
const MEANING = {
  decompiled: "read out of the ATP Manager JARs — strongest evidence",
  port: "ported from the reference Python decoder",
  corpus: "inferred from ground-truth EDIDs, no spec PDF registered",
  unknown: "no provenance recorded",
};
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  out.push(`| ${k} | ${n} | ${MEANING[k] ?? ""} |`);
}
out.push("");

const uncited = fields.filter((f) => !f.specDoc);
if (uncited.length) {
  out.push(`### Fields with no spec document (${uncited.length})`);
  out.push("");
  out.push("These are implemented but cannot be drift-checked, because no registered PDF covers them:");
  out.push("");
  for (const f of uncited) out.push(`- \`${f.path}\` — ${f.label}${f.note ? ` (${f.note})` : ""}`);
  out.push("");
}

out.push("## Extraction corpus");
out.push("");
out.push(`${extracted.total} field record(s) across ${extracted.byStem.size} document(s); ` +
  `${extracted.withOffset} carry a numeric byte offset.`);
out.push("");
out.push("These records name fields and give offsets/bit ranges, but contain **no scale factors** " +
  "(the `x5 MHz` behind Max_TMDS_Character_Rate appears in none of them). They are useful for " +
  "spotting that a field moved or appeared — not for generating a decoder.");
out.push("");
out.push("## What to do with this");
out.push("");
out.push("1. Implement the change in typed TypeScript, citing the document in `spec/field-map.json`.");
out.push("2. Run `npm run test:corpus` — 1,397 real EDIDs must still round-trip byte-exactly.");
out.push("3. Re-run with `--write` to accept the new document hashes as the baseline.");

const text = out.join("\n") + "\n";
console.log(text);

if (write) {
  const docs = {};
  for (const r of rows) if (r.sha) docs[r.stem] = r.sha;
  writeFileSync(BASELINE, JSON.stringify({ updated: new Date().toISOString(), docs }, null, 2) + "\n");
  console.error(`baseline written to ${BASELINE} (${Object.keys(docs).length} documents)`);
}

process.exitCode = changed.length > 0 ? 1 : 0;
