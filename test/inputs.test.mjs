import test from "node:test";
import assert from "node:assert/strict";
import { decodeEdid, encodeEdid } from "../packages/edid-core/dist/index.js";
import { createBlankEdid } from "../packages/edid-core/dist/template.js";
import { flattenEdid } from "../packages/edid-core/dist/flatten.js";
import { applyField, isFieldEditable } from "../packages/edid-core/dist/applyField.js";
import { describeInput, describeCount } from "../packages/edid-core/dist/inputs.js";
import {
  addExtension, addCtaBlock, addDisplayIdBlock,
  ctaBlockCatalogue, displayIdBlockCatalogue,
} from "../packages/edid-core/dist/structure.js";

/*
 * `describeInput` and `applyField` are two sources for the same truth: what a
 * field will accept. They cannot be merged cheaply — one is a render-time
 * lookup, the other 47 scattered `clampInt` calls — so these tests close the
 * gap instead, by probing the writer with each declared bound.
 */

/** One file carrying as much of the catalogue as the byte budget allows. */
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
  addExtension(edid, "displayid");
  const did = edid.extensions.length - 1;
  for (const spec of displayIdBlockCatalogue()) {
    try {
      addDisplayIdBlock(edid, did, spec.tag);
    } catch {
      addExtension(edid, "displayid");
      addDisplayIdBlock(edid, edid.extensions.length - 1, spec.tag);
    }
  }
  return edid;
}

const editableFields = (edid) =>
  flattenEdid(edid).filter((f) => f.role === "field" && isFieldEditable(f.path));

test("P1: every editable field has an input affordance", () => {
  const missing = [];
  for (const f of editableFields(maximalEdid())) {
    if (describeInput(f.path, f.kind) === null) missing.push(f.path);
  }
  assert.deepEqual(missing.slice(0, 10), [],
    missing.length + " editable field(s) have no input affordance");
});

test("P2: a declared numeric range is exactly what applyField accepts", () => {
  const template = maximalEdid();
  const wrong = [];

  for (const f of editableFields(template)) {
    const input = describeInput(f.path, f.kind);
    if (!input || input.control !== "number") continue;
    if (input.min === undefined || input.max === undefined) continue;

    // In-range values must be accepted, out-of-range must throw. `applyField`
    // returning false would mean no writer at all, which is a different bug.
    for (const value of [input.min, input.max]) {
      const edid = maximalEdid();
      try {
        if (!applyField(edid, f.path, value)) wrong.push(f.path + ": refused in-range " + value);
      } catch (e) {
        wrong.push(f.path + ": rejected in-range " + value + " (" + e.message + ")");
      }
    }
    for (const value of [input.min - 1, input.max + 1]) {
      if (value < 0 && input.min === 0) continue;   // no negative input to reject
      const edid = maximalEdid();
      let threw = false;
      try { applyField(edid, f.path, value); } catch { threw = true; }
      if (!threw) wrong.push(f.path + ": accepted out-of-range " + value);
    }
  }
  assert.deepEqual(wrong.slice(0, 10), [], wrong.length + " range mismatch(es)");
});

test("P3: every select option is a value applyField accepts", () => {
  const bad = [];
  for (const f of editableFields(maximalEdid())) {
    const input = describeInput(f.path, f.kind);
    if (!input || input.control !== "select") continue;
    assert.ok(input.options.length > 0, f.path + ": empty option list");

    for (const opt of input.options) {
      const edid = maximalEdid();
      try {
        if (!applyField(edid, f.path, opt.value)) {
          bad.push(f.path + " = " + opt.value + " (" + opt.label + "): refused");
        }
      } catch (e) {
        bad.push(f.path + " = " + opt.value + " (" + opt.label + "): " + e.message);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " unusable dropdown option(s)");
});

test("P4: a select commits the raw code, never the label", () => {
  const edid = maximalEdid();
  const field = flattenEdid(edid).find(
    (f) => f.role === "field" && isFieldEditable(f.path) && /\.sad\d+\.format$/.test(f.path));
  assert.ok(field, "the maximal file should carry an audio block");

  const input = describeInput(field.path, field.kind);
  assert.equal(input.control, "select");
  const lpcm = input.options.find((o) => o.label === "LPCM");
  assert.equal(lpcm.value, 1, "the option value is the CTA format code");

  applyField(edid, field.path, lpcm.value);
  const after = flattenEdid(edid).find((f) => f.path === field.path);
  assert.equal(after.value, 1, "the stored value stays a raw code");
});

test("P5: count cells exist for the lists structure editing can resize", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  addCtaBlock(edid, 0, "video");
  addCtaBlock(edid, 0, "audio");

  const groups = flattenEdid(edid).filter((f) => f.role === "group");
  const withCount = groups.filter((g) => describeCount(g.path) !== null).map((g) => g.path);
  assert.ok(withCount.includes("cta0.vdb"), "SVD list needs a count cell: " + withCount.join(", "));
  assert.ok(withCount.includes("cta0.adb"), "SAD list needs a count cell: " + withCount.join(", "));
});

test("P6: hex affordances match the bytes the field really holds", () => {
  const edid = maximalEdid();
  for (const f of editableFields(edid)) {
    const input = describeInput(f.path, f.kind);
    if (!input || input.control !== "hex" || input.bytes === null) continue;
    const text = String(f.value).replace(/^0x/i, "");
    assert.ok(text.length <= input.bytes * 2,
      f.path + ": value " + f.value + " exceeds the declared " + input.bytes + " byte(s)");
  }
});

test("P7: affordances survive a codec round-trip unchanged", () => {
  // The UI looks up affordances from decoded files, not from models it built.
  const edid = maximalEdid();
  const round = decodeEdid(encodeEdid(edid));
  for (const f of editableFields(round)) {
    assert.ok(describeInput(f.path, f.kind) !== null, f.path + " lost its affordance");
  }
});
