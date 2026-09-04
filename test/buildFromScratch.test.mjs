import test from "node:test";
import assert from "node:assert/strict";
import { decodeEdid, encodeEdid } from "../packages/edid-core/dist/index.js";
import { createBlankEdid } from "../packages/edid-core/dist/template.js";
import { flattenEdid } from "../packages/edid-core/dist/flatten.js";
import { applyField, isFieldEditable } from "../packages/edid-core/dist/applyField.js";
import {
  addExtension, addCtaBlock, addCtaDtd, addDisplayIdBlock,
  setDescriptorKind, setListCount, ctaBlockCatalogue, displayIdBlockCatalogue,
} from "../packages/edid-core/dist/structure.js";

/*
 * "Make a new .ddc and build a spec into it."
 *
 * This is the user-facing requirement, expressed as a test: start from an empty
 * file and, using only the public API the web UI calls, assemble a monitor spec
 * with CTA and DisplayID content — then prove it is a real EDID.
 *
 * Before this round a new file exposed 64 field shapes and a production file
 * exposed 255; 191 of them were simply unreachable because nothing could create
 * an extension. The reachability assertion below is what stops that regressing.
 */

const shape = (p) => p.replace(/\d+/g, "#");

function checksumsValid(bytes) {
  for (let b = 0; b < bytes.length; b += 128) {
    let s = 0;
    for (let i = 0; i < 128; i++) s += bytes[b + i];
    if (s % 256 !== 0) return false;
  }
  return true;
}

test("N1: a full spec can be built from an empty file with the public API alone", () => {
  const edid = createBlankEdid();

  // --- identity, straight through applyField ---------------------------------
  const identity = [
    ["base.manufacturer", "SAM"],
    ["base.productCode", 0x7042],
    ["base.serialNumber", 123456],
    ["base.year", 2026],
    ["base.week", 12],
    ["base.desc2.name", "TEST MONITOR"],
  ];
  for (const [path, value] of identity) {
    assert.ok(isFieldEditable(path), path + " should be editable");
    assert.equal(applyField(edid, path, value), true, path);
  }

  // --- a second detailed timing in the spare descriptor slot ------------------
  assert.equal(setDescriptorKind(edid, 3, "detailed-timing"), true);
  assert.equal(applyField(edid, "base.desc3.dtd.hActive", 2560), true);
  assert.equal(applyField(edid, "base.desc3.dtd.vActive", 1440), true);

  // --- a CTA extension with the blocks a real monitor carries -----------------
  assert.equal(addExtension(edid, "cta"), true);
  for (const id of ["video", "audio", "speaker", "colorimetry", "hdrStatic",
                    "y420cmdb", "hdmi14b", "hdmiForum"]) {
    assert.equal(addCtaBlock(edid, 0, id), true, id);
  }
  assert.equal(addCtaDtd(edid, 0), true);

  assert.equal(setListCount(edid, "cta0.vdb", 4), true);
  assert.equal(setListCount(edid, "cta0.adb", 2), true);
  assert.equal(applyField(edid, "cta0.svd.vics", "16*, 31, 32, 34"), true);
  assert.equal(applyField(edid, "cta0.basicAudio", true), true);
  assert.equal(applyField(edid, "cta0.sad0.maxChannels", 8), true);
  assert.equal(applyField(edid, "cta0.ext6.eotf2", true), true);

  // --- a DisplayID extension --------------------------------------------------
  assert.equal(addExtension(edid, "displayid"), true);
  for (const tag of [0x03, 0x25, 0x2b]) {
    assert.equal(addDisplayIdBlock(edid, 1, tag), true, "DisplayID tag " + tag);
  }

  // --- it has to be a real EDID ----------------------------------------------
  const bytes = encodeEdid(edid);
  assert.equal(bytes.length, 384, "base + CTA + DisplayID");
  assert.ok(checksumsValid(bytes), "every block checksum must be valid");
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0, 255, 255, 255, 255, 255, 255, 0],
    "the EDID header magic");

  // --- and it has to survive the codec unchanged ------------------------------
  const round = decodeEdid(bytes);
  assert.deepEqual(Array.from(encodeEdid(round)), Array.from(bytes), "not byte-stable");

  // --- the edited values have to still be there -------------------------------
  const byPath = new Map(flattenEdid(round).map((f) => [f.path, f.value]));
  assert.equal(byPath.get("base.manufacturer"), "SAM");
  assert.equal(byPath.get("base.desc2.name"), "TEST MONITOR");
  assert.equal(byPath.get("base.desc3.dtd.hActive"), 2560);
  assert.equal(byPath.get("cta0.sad0.maxChannels"), 8);
  assert.equal(byPath.get("did1.db1.maxRefresh"), 144);
});

test("N2: the catalogue reaches the field shapes a production EDID carries", () => {
  // Assemble one of everything the catalogue offers, spread over as many CTA
  // extensions as the byte budget needs.
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  let ctaIndex = 0;
  for (const spec of ctaBlockCatalogue()) {
    try {
      addCtaBlock(edid, ctaIndex, spec.id);
    } catch {
      addExtension(edid, "cta");
      ctaIndex = edid.extensions.length - 1;
      addCtaBlock(edid, ctaIndex, spec.id);
    }
  }
  addExtension(edid, "displayid");
  const didIndex = edid.extensions.length - 1;
  for (const spec of displayIdBlockCatalogue()) {
    try {
      addDisplayIdBlock(edid, didIndex, spec.tag);
    } catch {
      addExtension(edid, "displayid");
      addDisplayIdBlock(edid, edid.extensions.length - 1, spec.tag);
    }
  }
  for (const { kind } of [{ kind: "range-limits" }, { kind: "serial-number" }, { kind: "text" }]) {
    setDescriptorKind(edid, 3, kind);
  }

  const bytes = encodeEdid(edid);
  assert.ok(checksumsValid(bytes), "the maximal file must still checksum");

  const fields = flattenEdid(edid).filter((f) => f.role === "field");
  const shapes = new Set(fields.map((f) => shape(f.path)));
  const editable = new Set(fields.filter((f) => isFieldEditable(f.path)).map((f) => shape(f.path)));

  // A blank file reached 64 shapes / 54 editable before this module existed.
  assert.ok(shapes.size > 200,
    "expected 200+ reachable field shapes from scratch, got " + shapes.size);
  assert.ok(editable.size > 190,
    "expected 190+ editable shapes from scratch, got " + editable.size);
  console.log("      reachable from an empty file: " + shapes.size
    + " field shapes, " + editable.size + " editable");
});

test("N3: everything reachable from scratch is also actually writable", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  for (const id of ["video", "audio", "speaker", "colorimetry", "hdrStatic", "hdmi14b"]) {
    addCtaBlock(edid, 0, id);
  }

  const refused = [];
  for (const f of flattenEdid(edid)) {
    if (f.role !== "field" || !isFieldEditable(f.path)) continue;
    const next = typeof f.value === "boolean" ? !f.value : f.value;
    try {
      if (!applyField(edid, f.path, next)) refused.push(f.path);
    } catch {
      // A value the writer rejects is fine here; only a missing writer is not.
    }
  }
  assert.deepEqual(refused, [],
    refused.length + " field(s) are editable per the gate but have no writer");
  assert.ok(checksumsValid(encodeEdid(edid)));
});
