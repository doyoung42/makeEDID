import test from "node:test";
import assert from "node:assert/strict";
import { decodeEdid, encodeEdid } from "../packages/edid-core/dist/index.js";
import { createBlankEdid } from "../packages/edid-core/dist/template.js";
import { flattenEdid } from "../packages/edid-core/dist/flatten.js";
import {
  addExtension, removeExtension, addCtaBlock, addCtaDtd, removeCtaDtd,
  addDisplayIdBlock, setDescriptorKind, setListCount,
  ctaBlockCatalogue, displayIdBlockCatalogue,
  DESCRIPTOR_KINDS, ctaFreeBytes, displayIdFreeBytes,
  structureTargetFor, removeAtPath, addTargetFor,
} from "../packages/edid-core/dist/structure.js";

/*
 * Structural editing: adding and removing blocks rather than changing values.
 *
 * The risk these tests cover is specific — a wrong catalogue default would
 * quietly produce a malformed EDID that still checksums, so every default is
 * pushed through the real codec and compared back.
 */

function checksumsValid(bytes) {
  for (let b = 0; b < bytes.length; b += 128) {
    let s = 0;
    for (let i = 0; i < 128; i++) s += bytes[b + i];
    if (s % 256 !== 0) return false;
  }
  return true;
}

test("X1: a blank file can grow a CTA extension, and it round-trips", () => {
  const edid = createBlankEdid();
  assert.equal(edid.extensions.length, 0);
  assert.equal(addExtension(edid, "cta"), true);

  const bytes = encodeEdid(edid);
  assert.equal(bytes.length, 256, "one extension block was appended");
  assert.ok(checksumsValid(bytes));
  assert.equal(bytes[126], 1, "base byte 126 tracks the extension count");

  const round = decodeEdid(bytes);
  assert.equal(round.extensions.length, 1);
  assert.equal(round.extensions[0].kind, "cta");
});

test("X2: every CTA catalogue default is a valid block that survives a round-trip", () => {
  const catalogue = ctaBlockCatalogue();
  assert.ok(catalogue.length >= 15, "expected a real catalogue, got " + catalogue.length);

  for (const spec of catalogue) {
    const edid = createBlankEdid();
    addExtension(edid, "cta");
    assert.equal(addCtaBlock(edid, 0, spec.id), true, spec.id);

    const bytes = encodeEdid(edid);
    assert.ok(checksumsValid(bytes), spec.id + ": checksums");

    const round = decodeEdid(bytes);
    const blocks = round.extensions[0].dataBlocks;
    assert.equal(blocks.length, 1, spec.id + ": expected exactly one data block");
    assert.equal(blocks[0].kind, spec.make().kind, spec.id + ": kind changed through the codec");
    assert.deepEqual(Array.from(encodeEdid(round)), Array.from(bytes), spec.id + ": not byte-stable");
  }
});

test("X3: every DisplayID catalogue default round-trips", () => {
  for (const spec of displayIdBlockCatalogue()) {
    const edid = createBlankEdid();
    addExtension(edid, "displayid");
    assert.equal(addDisplayIdBlock(edid, 0, spec.tag), true, spec.label);

    const bytes = encodeEdid(edid);
    assert.ok(checksumsValid(bytes), spec.label + ": checksums");

    const round = decodeEdid(bytes);
    const blocks = round.extensions[0].dataBlocks;
    assert.equal(blocks.length, 1, spec.label + ": block count");
    assert.equal(blocks[0].tag, spec.tag, spec.label + ": tag");
    assert.deepEqual(Array.from(blocks[0].payload), spec.payload, spec.label + ": payload");
    assert.deepEqual(Array.from(encodeEdid(round)), Array.from(bytes), spec.label + ": not byte-stable");
  }
});

test("X4: adding a block leaves every byte before it untouched", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  addCtaBlock(edid, 0, "video");
  const before = encodeEdid(edid);

  addCtaBlock(edid, 0, "audio");
  const after = encodeEdid(edid);

  // The base block sits entirely ahead of the insertion point.
  for (let i = 0; i < 128; i++) {
    assert.equal(after[i], before[i], "base block byte " + i + " moved");
  }
  // CTA byte 130 is the DTD offset — a pointer past the data block collection,
  // so it is *supposed* to move when the collection grows. Everything else in
  // the header, and the video block preceding the new one, must not.
  for (const i of [128, 129, 131, 132]) {
    assert.equal(after[i], before[i], "byte " + i + " moved but sits before the insertion point");
  }
  assert.equal(before[130], 6, "video block: 1 header + 1 SVD, so DTDs start at 6");
  assert.equal(after[130], 10, "audio block adds 1 header + 3 SAD bytes");
  assert.ok(checksumsValid(after));
});

test("X5: the byte budget is enforced, and a refused add changes nothing", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  const ext = edid.extensions[0];

  let added = 0;
  let refusal = null;
  for (let i = 0; i < 200; i++) {
    try {
      if (!addCtaBlock(edid, 0, "hdmiForum")) break;
      added++;
    } catch (e) {
      refusal = e;
      break;
    }
  }
  assert.ok(added > 0, "should fit at least one block");
  assert.ok(refusal, "should refuse rather than corrupt the block");
  assert.match(refusal.message, /overflow|at most 31/i);

  assert.equal(ext.dataBlocks.length, added, "the refused block was rolled back");
  assert.ok(checksumsValid(encodeEdid(edid)), "the model still encodes after a refusal");
  assert.ok(ctaFreeBytes(ext) < 8, "the extension really is nearly full");
});

test("X6: every descriptor slot can become every descriptor kind", () => {
  for (const { kind } of DESCRIPTOR_KINDS) {
    for (let slot = 0; slot < 4; slot++) {
      const edid = createBlankEdid();
      assert.equal(setDescriptorKind(edid, slot, kind), true, "slot " + slot + " -> " + kind);
      assert.equal(edid.base.descriptors[slot].kind, kind);
      const bytes = encodeEdid(edid);
      assert.ok(checksumsValid(bytes), "slot " + slot + " " + kind + ": checksums");
      assert.equal(decodeEdid(bytes).base.descriptors[slot].kind, kind,
        "slot " + slot + " " + kind + ": did not survive the codec");
    }
  }
});

test("X7: list counts grow and shrink, and the bytes stay valid", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  addCtaBlock(edid, 0, "video");
  addCtaBlock(edid, 0, "audio");

  for (const [path, count] of [["cta0.vdb", 8], ["cta0.adb", 4], ["cta0.vdb", 2], ["cta0.adb", 1]]) {
    assert.equal(setListCount(edid, path, count), true, path + " -> " + count);
    const bytes = encodeEdid(edid);
    assert.ok(checksumsValid(bytes), path + " " + count + ": checksums");
    assert.deepEqual(Array.from(encodeEdid(decodeEdid(bytes))), Array.from(bytes), path + " " + count);
  }
  assert.equal(edid.extensions[0].dataBlocks.find((b) => b.kind === "video").svds.length, 2);
  assert.equal(edid.extensions[0].dataBlocks.find((b) => b.kind === "audio").sads.length, 1);

  assert.throws(() => setListCount(edid, "cta0.vdb", -1), /non-negative/);
});

test("X8: CTA detailed timings can be added and removed", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  assert.equal(addCtaDtd(edid, 0), true);
  assert.equal(addCtaDtd(edid, 0), true);
  assert.equal(edid.extensions[0].detailedTimings.length, 2);
  assert.ok(checksumsValid(encodeEdid(edid)));

  assert.equal(removeCtaDtd(edid, 0, 0), true);
  const bytes = encodeEdid(edid);
  assert.ok(checksumsValid(bytes));
  assert.equal(decodeEdid(bytes).extensions[0].detailedTimings.length, 1);
});

test("X9: removing an extension updates the count and the remaining bytes", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  addExtension(edid, "displayid");
  assert.equal(encodeEdid(edid).length, 384);

  assert.equal(removeExtension(edid, 0), true);
  const bytes = encodeEdid(edid);
  assert.equal(bytes.length, 256);
  assert.equal(bytes[126], 1);
  assert.ok(checksumsValid(bytes));
  assert.equal(decodeEdid(bytes).extensions[0].kind, "displayid");

  assert.equal(removeExtension(edid, 9), false, "out of range is a refusal, not a throw");
});

test("X10: an EEODB is kept in step when extensions are added", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  addCtaBlock(edid, 0, "eeodb");
  addExtension(edid, "cta");

  const eeodb = edid.extensions[0].dataBlocks.find(
    (b) => b.kind === "extended" && b.extendedTag === 0x78);
  assert.equal(eeodb.payload[0], 2, "the EEODB must carry the real extension count");

  // With an EEODB present base byte 126 keeps its legacy value instead of
  // tracking the physical count — breaking that rule corrupted 249 EDIDs once.
  const bytes = encodeEdid(edid);
  assert.equal(bytes.length, 384);
  assert.ok(checksumsValid(bytes));
});

test("X11: structural adds actually open new editable rows", () => {
  const before = new Set(flattenEdid(createBlankEdid()).map((f) => f.path));

  const edid = createBlankEdid();
  addExtension(edid, "cta");
  for (const id of ["video", "audio", "speaker", "hdmi14b", "hdrStatic"]) addCtaBlock(edid, 0, id);
  const after = new Set(flattenEdid(edid).map((f) => f.path));

  const gained = [...after].filter((p) => !before.has(p));
  assert.ok(gained.length > 40, "expected 40+ new rows, got " + gained.length);

  const did = createBlankEdid();
  addExtension(did, "displayid");
  assert.ok(displayIdFreeBytes(did.extensions[0]) > 100);
});

test("X12: every block row resolves to the block it stands for, and can be removed", () => {
  const build = () => {
    const e = createBlankEdid();
    addExtension(e, "cta");
    for (const id of ["video", "audio", "speaker", "colorimetry", "hdmi14b", "hdmiForum", "typeVII"]) {
      addCtaBlock(e, 0, id);
    }
    addExtension(e, "displayid");
    addDisplayIdBlock(e, 1, 0x25);
    return e;
  };

  const groups = flattenEdid(build()).filter((f) => f.role === "block" || f.role === "group");
  const removable = groups.filter((g) => structureTargetFor(build(), g.path) !== null);
  assert.ok(removable.length >= 10,
    "expected 10+ addressable structure rows, got " + removable.length
      + " of " + groups.length);

  // Each one must actually remove exactly one thing and leave a valid EDID.
  for (const row of removable) {
    const edid = build();
    const target = structureTargetFor(edid, row.path);
    const before = target.kind === "extension"
      ? edid.extensions.length
      : target.kind === "cta-block"
        ? edid.extensions[target.extIndex].dataBlocks.length
        : target.kind === "did-block"
          ? edid.extensions[target.extIndex].dataBlocks.length
          : 0;

    assert.equal(removeAtPath(edid, row.path), true, row.path + ": remove refused");
    if (target.kind !== "descriptor") {
      const after = target.kind === "extension"
        ? edid.extensions.length
        : edid.extensions[target.extIndex]?.dataBlocks.length ?? 0;
      assert.equal(after, before - 1, row.path + ": should remove exactly one");
    }
    assert.ok(checksumsValid(encodeEdid(edid)), row.path + ": checksums after removal");
  }
});

test("X13: the base block itself is never removable", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  assert.equal(structureTargetFor(edid, "block0"), null, "block 0 is the base block");
  assert.equal(removeAtPath(edid, "block0"), false);
  assert.equal(removeAtPath(edid, "nonsense.path"), false);
});

test("X14: a + on an extension row offers the right catalogue", () => {
  const edid = createBlankEdid();
  addExtension(edid, "cta");
  addExtension(edid, "displayid");
  assert.deepEqual(addTargetFor(edid, "block1"), { kind: "cta", extIndex: 0 });
  assert.deepEqual(addTargetFor(edid, "block2"), { kind: "displayid", extIndex: 1 });
  assert.equal(addTargetFor(edid, "block0"), null, "nothing is added into the base block");
});
