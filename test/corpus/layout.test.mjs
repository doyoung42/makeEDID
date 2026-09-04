/**
 * The layout map must agree with the encoder about where everything sits.
 *
 * These assertions are the reason the byte-highlighting in the UI can be
 * trusted: rather than checking the map against a hand-written offset table,
 * they check it against the bytes the encoder actually produced, over every
 * real EDID in the corpus.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEdid, encodeEdid, computeLayout, splitBlocks, BLOCK_SIZE, asVendorBlock, ouiToString,
} from "../../packages/edid-core/dist/index.js";
import { loadCorpus, corpusAvailable, CORPUS_ROOT } from "./loader.mjs";

const skip = corpusAvailable() ? false : `corpus not found at ${CORPUS_ROOT}`;

/** Every region the map defines, flattened, with a label for error messages. */
function allRegions(layout) {
  const out = [];
  const push = (label, r) => { if (r) out.push({ label, r }); };

  layout.blocks.forEach((b, i) => {
    push(`block${i}.whole`, b.whole);
    push(`block${i}.checksum`, b.checksum);
    b.descriptors?.forEach((r, d) => push(`block${i}.desc${d}`, r));

    if (b.cta) {
      push(`block${i}.cta.header`, b.cta.header);
      b.cta.dataBlocks.forEach((db, n) => {
        if (!db) return;
        push(`block${i}.cta.db${n}.whole`, db.whole);
        push(`block${i}.cta.db${n}.header`, db.header);
        push(`block${i}.cta.db${n}.payload`, db.payload);
        push(`block${i}.cta.db${n}.vendor`, db.vendorPayload);
      });
      b.cta.detailedTimings.forEach((r, n) => push(`block${i}.cta.dtd${n}`, r));
      push(`block${i}.cta.padding`, b.cta.padding);
    }

    if (b.displayid) {
      push(`block${i}.did.header`, b.displayid.header);
      b.displayid.dataBlocks.forEach((db, n) => {
        push(`block${i}.did.db${n}.whole`, db.whole);
        push(`block${i}.did.db${n}.header`, db.header);
        push(`block${i}.did.db${n}.payload`, db.payload);
      });
      push(`block${i}.did.sectionChecksum`, b.displayid.sectionChecksum);
      push(`block${i}.did.paddingBefore`, b.displayid.paddingBefore);
      push(`block${i}.did.paddingAfter`, b.displayid.paddingAfter);
    }
  });

  return out;
}

test("L1: every region lies inside its 128-byte block", { skip }, () => {
  const bad = [];

  for (const { file, bytes } of loadCorpus()) {
    const edid = decodeEdid(bytes);
    const layout = computeLayout(edid);
    const blockCount = splitBlocks(encodeEdid(edid)).length;

    for (const { label, r } of allRegions(layout)) {
      if (r.blockIndex < 0 || r.blockIndex >= blockCount) bad.push(`${file} ${label}: block ${r.blockIndex} of ${blockCount}`);
      else if (r.offset < 0 || r.length < 0) bad.push(`${file} ${label}: negative offset/length`);
      else if (r.offset + r.length > BLOCK_SIZE) bad.push(`${file} ${label}: ends at ${r.offset + r.length}`);
    }
  }

  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} out-of-range region(s)`);
});

test("L2: one block layout covers every physical block", { skip }, () => {
  const bad = [];
  for (const { file, bytes } of loadCorpus()) {
    const edid = decodeEdid(bytes);
    const emitted = splitBlocks(encodeEdid(edid)).length;
    const mapped = computeLayout(edid).blocks.length;
    if (emitted !== mapped) bad.push(`${file}: encoder emitted ${emitted} block(s), layout mapped ${mapped}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} block-count mismatch(es)`);
});

test("L3: CTA data-block headers land on the bytes the encoder wrote", { skip }, () => {
  const bad = [];
  let checked = 0;

  for (const { file, bytes } of loadCorpus()) {
    const edid = decodeEdid(bytes);
    const blocks = splitBlocks(encodeEdid(edid));
    const layout = computeLayout(edid);

    edid.extensions.forEach((ext, i) => {
      if (ext.kind !== "cta") return;
      const cta = layout.blocks[i + 1].cta;
      const raw = blocks[i + 1];

      ext.dataBlocks.forEach((block, n) => {
        const r = cta.dataBlocks[n];
        if (!r) return;
        checked++;

        const header = raw[r.whole.offset];
        const tag = header >> 5;
        const length = header & 0x1f;

        // The header byte at the mapped offset must describe this very block.
        if (1 + length !== r.whole.length) {
          bad.push(`${file} cta${i}.db${n}: header says ${1 + length} bytes, layout says ${r.whole.length}`);
        }
        if (block.kind === "extended" && raw[r.whole.offset + 1] !== block.extendedTag) {
          bad.push(`${file} cta${i}.db${n}: extended tag ${raw[r.whole.offset + 1]} != ${block.extendedTag}`);
        }
        if (block.kind === "vendor-specific" && tag !== 3) {
          bad.push(`${file} cta${i}.db${n}: tag ${tag} is not vendor-specific`);
        }

        // For vendor blocks the OUI must sit immediately before the payload we
        // hand to parseVsdb — that is what makes the highlight land correctly.
        const ref = asVendorBlock(block);
        if (ref && r.vendorPayload) {
          const o = r.vendorPayload.offset;
          const oui = (raw[o - 1] << 16) | (raw[o - 2] << 8) | raw[o - 3];
          if (oui !== ref.oui) {
            bad.push(`${file} cta${i}.db${n}: OUI before payload is ${ouiToString(oui)}, expected ${ouiToString(ref.oui)}`);
          }
        }
      });
    });
  }

  console.log(`      ${checked} CTA data block region(s) verified against encoder output`);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} CTA layout mismatch(es)`);
});

test("L4: DisplayID block headers land on the bytes the encoder wrote", { skip }, () => {
  const bad = [];
  let checked = 0;

  for (const { file, bytes } of loadCorpus()) {
    const edid = decodeEdid(bytes);
    const blocks = splitBlocks(encodeEdid(edid));
    const layout = computeLayout(edid);

    edid.extensions.forEach((ext, i) => {
      if (ext.kind !== "displayid") return;
      const did = layout.blocks[i + 1].displayid;
      const raw = blocks[i + 1];

      ext.dataBlocks.forEach((db, n) => {
        const r = did.dataBlocks[n];
        if (!r) return;
        checked++;
        const o = r.whole.offset;
        if (raw[o] !== db.tag) bad.push(`${file} did${i}.db${n}: tag ${raw[o]} != ${db.tag}`);
        if (raw[o + 1] !== db.revision) bad.push(`${file} did${i}.db${n}: revision mismatch`);
        if (raw[o + 2] !== db.payload.length) bad.push(`${file} did${i}.db${n}: length ${raw[o + 2]} != ${db.payload.length}`);
      });

      // The mapped checksum position must hold a checksum that actually works.
      const c = did.sectionChecksum.offset;
      let sum = 0;
      for (let k = 1; k <= c; k++) sum += raw[k];
      if (sum % 256 !== 0) bad.push(`${file} did${i}: section checksum at ${c} does not balance`);
    });
  }

  console.log(`      ${checked} DisplayID data block region(s) verified against encoder output`);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} DisplayID layout mismatch(es)`);
});

test("L5: sibling regions do not overlap", { skip }, () => {
  const bad = [];

  for (const { file, bytes } of loadCorpus()) {
    const layout = computeLayout(decodeEdid(bytes));

    layout.blocks.forEach((b, i) => {
      // Data blocks, DTDs and padding partition the space after the header.
      const spans = [];
      if (b.cta) {
        for (const db of b.cta.dataBlocks) if (db) spans.push(["db", db.whole]);
        b.cta.detailedTimings.forEach((r) => spans.push(["dtd", r]));
        spans.push(["padding", b.cta.padding]);
      }
      if (b.displayid) {
        for (const db of b.displayid.dataBlocks) spans.push(["db", db.whole]);
        // paddingBefore / checksum / paddingAfter are disjoint by construction;
        // the decoder's own `padding` deliberately spans the checksum, which is
        // why the layout splits it rather than exposing one range.
        spans.push(["padBefore", b.displayid.paddingBefore]);
        spans.push(["checksum", b.displayid.sectionChecksum]);
        spans.push(["padAfter", b.displayid.paddingAfter]);
      }
      if (b.descriptors) b.descriptors.forEach((r, d) => spans.push([`desc${d}`, r]));

      const sorted = spans.filter(([, r]) => r.length > 0).sort((x, y) => x[1].offset - y[1].offset);
      for (let k = 1; k < sorted.length; k++) {
        const [pn, pr] = sorted[k - 1];
        const [nn, nr] = sorted[k];
        if (pr.offset + pr.length > nr.offset) {
          bad.push(`${file} block${i}: ${pn}@${pr.offset}+${pr.length} overlaps ${nn}@${nr.offset}`);
        }
      }
    });
  }

  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} overlapping sibling region(s)`);
});
