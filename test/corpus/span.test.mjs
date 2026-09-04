/**
 * Do the byte spans actually describe the bytes an edit changes?
 *
 * Rather than compare the spans to a hand-written offset table (which would
 * just be the same guesses twice), this perturbs each editable field on real
 * EDIDs, re-encodes, and checks that every byte that moved is inside the span
 * the row advertises — plus the checksums, which necessarily follow any change.
 *
 * This is what makes the hex highlighting in the UI trustworthy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEdid, encodeEdid, flattenEdid, applyField, isFieldEditable, BLOCK_SIZE, computeLayout,
} from "../../packages/edid-core/dist/index.js";
import { loadCorpus, corpusAvailable, CORPUS_ROOT } from "./loader.mjs";

const skip = corpusAvailable() ? false : `corpus not found at ${CORPUS_ROOT}`;

/** Collapse indices so `cta0.dtd1.clock` and `cta2.dtd0.clock` count as one shape. */
function shapeOf(path) {
  return path.replace(/(?<=^|\.)(cta|did|ext|desc|db|sad|dtd|as|block|3dEntry)\d+/g, "$1*");
}

/** A different, still-valid value for a field, or null when we cannot make one. */
function perturb(field) {
  const v = field.value;
  switch (field.kind) {
    case "boolean": return !v;
    case "number": {
      if (typeof v !== "number") return null;
      // Step down when possible: most numeric fields have a low ceiling.
      return v > 0 ? v - 1 : 1;
    }
    case "string": {
      if (typeof v !== "string" || v.length === 0) return null;
      return v[0] === "A" ? "B" + v.slice(1) : "A" + v.slice(1);
    }
    default: return null;   // enum and hex have no safe generic perturbation
  }
}

/** Byte indices allowed to change: the field's own span plus every checksum. */
function permittedBytes(edid, span) {
  const allowed = new Set();
  for (let i = 0; i < span.byteLength; i++) {
    allowed.add(span.blockIndex * BLOCK_SIZE + span.byteOffset + i);
  }

  const layout = computeLayout(edid);
  layout.blocks.forEach((b, i) => {
    allowed.add(i * BLOCK_SIZE + BLOCK_SIZE - 1);            // block checksum
    if (b.displayid) {
      allowed.add(i * BLOCK_SIZE + b.displayid.sectionChecksum.offset);
    }
  });
  return allowed;
}

test("S1: editing a field changes only the bytes its span claims", { skip }, () => {
  const violations = [];
  const probedShapes = new Map();
  let probes = 0;
  let noOpEdits = 0;
  const noOpShapes = new Map();
  const refusedShapes = new Map();

  const SATURATION = 4;   // stop probing a shape once it has this many clean results

  for (const { file, bytes } of loadCorpus()) {
    const template = decodeEdid(bytes);
    const fields = flattenEdid(template, bytes);

    // Skip files that add no new coverage — the corpus repeats models heavily.
    const useful = fields.some(
      (f) => f.span && isFieldEditable(f.path) && (probedShapes.get(shapeOf(f.path)) ?? 0) < SATURATION,
    );
    if (!useful) continue;

    for (const field of fields) {
      if (!field.span || !isFieldEditable(field.path)) continue;
      const shape = shapeOf(field.path);
      if ((probedShapes.get(shape) ?? 0) >= SATURATION) continue;

      const next = perturb(field);
      if (next === null) continue;

      const edid = decodeEdid(bytes);
      let before;
      try {
        before = encodeEdid(edid);
      } catch {
        continue;   // model the encoder refuses; not this test's concern
      }

      let applied = false;
      try {
        applied = applyField(edid, field.path, next);
      } catch {
        continue;   // rejected by validation: nothing to check
      }
      if (!applied) {
        // The gate said this field is editable, so the writer must be able to
        // write it. Per the codec contract a `false` return means "no writer
        // for this path" — a value the writer dislikes throws instead.
        refusedShapes.set(shape, (refusedShapes.get(shape) ?? 0) + 1);
        continue;
      }

      let after;
      try {
        after = encodeEdid(edid);
      } catch {
        continue;
      }

      probes++;
      probedShapes.set(shape, (probedShapes.get(shape) ?? 0) + 1);

      if (after.length !== before.length) {
        violations.push(`${file} ${field.path}: length changed ${before.length} -> ${after.length}`);
        continue;
      }

      const changed = [];
      for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed.push(i);
      if (changed.length === 0) {
        noOpEdits++;
        noOpShapes.set(shape, (noOpShapes.get(shape) ?? 0) + 1);
        continue;
      }

      const allowed = permittedBytes(edid, field.span);
      const stray = changed.filter((i) => !allowed.has(i));
      if (stray.length > 0) {
        const s = field.span;
        violations.push(
          `${file} ${field.path}: span block ${s.blockIndex} [${s.byteOffset}..${s.byteOffset + s.byteLength - 1}] ` +
          `but bytes ${stray.slice(0, 6).join(",")} also changed`,
        );
      }
    }
  }

  console.log(`      ${probes} edit(s) probed across ${probedShapes.size} field shape(s); ${noOpEdits} were no-ops`);

  /*
   * A no-op is an edit applyField accepted that changed no bytes. That is only
   * legitimate when the field's storage unit is coarser than the perturbation:
   * DTD pixel clocks are stored in 10 kHz units, range-limit max clock in
   * 10 MHz, and Max_TMDS in 5 MHz, so a +1 nudge rounds back to the same byte.
   *
   * Anything else silently discards a user's edit. That is exactly how the
   * Type VII/VIII/X writers stayed dead: the gate called them editable, the
   * catch-all above them answered first, and the probe counted the result as a
   * harmless no-op. Enumerating them keeps that failure visible.
   */
  const QUANTISED = new Set([
    "base.desc*.dtd.clock", "base.desc*.maxClock", "cta*.dtd*.clock",
    "cta*.vsdb.00-0C-03.maxTmds", "cta*.vsdb.C4-5D-D8.maxTmds",
  ]);
  const silent = [...noOpShapes.keys()].filter((s2) => !QUANTISED.has(s2)).sort();
  assert.deepEqual(silent, [],
    `${silent.length} field shape(s) accepted an edit but changed no bytes`);

  /*
   * The gate (`isFieldEditable`) and the writer (`applyField`) must agree. When
   * they drift, the UI offers a cell the user can type into and the save quietly
   * does nothing — the failure mode that kept the Type VII/VIII/X writers dead
   * behind an `ext<tag>.<field>` catch-all that matched their paths first.
   */
  const refused = [...refusedShapes.keys()].sort();
  assert.deepEqual(refused, [],
    `${refused.length} field shape(s) are editable per the gate but rejected by applyField`);
  assert.deepEqual(violations.slice(0, 8), [], `${violations.length} span violation(s)`);
  // Floor guards against the probe silently doing nothing (a bad `perturb`, a
  // broken editable check). Raise it as more fields gain spans.
  assert.ok(probedShapes.size >= 14, `only ${probedShapes.size} field shape(s) probed`);
});

test("S2: only known aggregates lack a byte span", { skip }, () => {
  // A missing span must mean "this row genuinely has no single byte range",
  // never "nobody got round to annotating it".
  const EXPECTED_SPANLESS = new Set([
    "cta*.svd.count",
    "cta*.sad.count",
    "did*.blockCount",
  ]);

  const found = new Map();
  for (const { file, bytes } of loadCorpus()) {
    for (const f of flattenEdid(decodeEdid(bytes), bytes)) {
      if (f.span !== null) continue;
      const shape = shapeOf(f.path);
      if (!found.has(shape)) found.set(shape, file);
    }
  }

  const unexpected = [...found].filter(([shape]) => !EXPECTED_SPANLESS.has(shape));
  console.log(`      ${found.size} span-less field shape(s)`);
  assert.deepEqual(
    unexpected.map(([shape, file]) => `${shape} (first seen in ${file})`).slice(0, 20),
    [],
    `${unexpected.length} field shape(s) have no byte span and are not known aggregates`,
  );
});

test("S3: every span lands inside the encoded bytes", { skip }, () => {
  const bad = [];
  for (const { file, bytes } of loadCorpus()) {
    const edid = decodeEdid(bytes);
    const total = encodeEdid(edid).length;
    for (const f of flattenEdid(edid, bytes)) {
      if (!f.span) continue;
      const start = f.span.blockIndex * BLOCK_SIZE + f.span.byteOffset;
      if (start < 0 || start + f.span.byteLength > total) {
        bad.push(`${file} ${f.path}: [${start}..${start + f.span.byteLength}) outside ${total} bytes`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} out-of-range span(s)`);
});
