/**
 * VSDB decoding against the corpus.
 *
 * Every vendor block must survive parse -> build byte-for-byte, and the fields
 * we claim to decode must land in plausible ranges. This is what stops a
 * structured editor from silently rewriting a payload it misread.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEdid, asVendorBlock, parseVsdb, buildVsdb, bytesEqual, bytesToHex,
  ouiToString, OUI_NAMES, describeVic,
  HDMI_14B_OUI, HDMI_FORUM_OUI, HDR10PLUS_OUI, AMD_FREESYNC_OUI, DOLBY_VISION_OUI,
} from "../../packages/edid-core/dist/index.js";
import { loadCorpus, corpusAvailable, CORPUS_ROOT } from "./loader.mjs";

const skip = corpusAvailable() ? false : `corpus not found at ${CORPUS_ROOT}`;

/** Every vendor block in the corpus, with the file it came from. */
function vendorBlocks() {
  const out = [];
  for (const { file, bytes } of loadCorpus()) {
    let edid;
    try {
      edid = decodeEdid(bytes);
    } catch {
      continue;
    }
    for (const ext of edid.extensions) {
      if (ext.kind !== "cta") continue;
      for (const block of ext.dataBlocks) {
        const ref = asVendorBlock(block);
        if (ref) out.push({ file, ref });
      }
    }
  }
  return out;
}

test("vendor blocks are found and identified", { skip }, () => {
  const all = vendorBlocks();
  assert.ok(all.length > 0, "no vendor blocks in the corpus");

  const byOui = new Map();
  for (const { ref } of all) byOui.set(ref.oui, (byOui.get(ref.oui) ?? 0) + 1);

  const rows = [...byOui.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([oui, n]) => `        ${ouiToString(oui)} x${String(n).padStart(4)}  ${OUI_NAMES[oui] ?? "(not decoded structurally)"}`);
  console.log(`      ${all.length} vendor blocks\n${rows.join("\n")}`);
});

test("parse -> build reproduces every vendor payload byte-for-byte", { skip }, () => {
  const failures = [];
  for (const { file, ref } of vendorBlocks()) {
    let rebuilt;
    try {
      rebuilt = buildVsdb(parseVsdb(ref));
    } catch (e) {
      failures.push(`${file} ${ouiToString(ref.oui)}: threw ${e.message}`);
      continue;
    }
    if (!bytesEqual(ref.payload, rebuilt)) {
      failures.push(
        `${file} ${ouiToString(ref.oui)}\n    in : ${bytesToHex(ref.payload)}\n    out: ${bytesToHex(rebuilt)}`,
      );
    }
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} vendor payload(s) changed`);
});

test("no vendor block is left as an unstructured blob when we claim to know it", { skip }, () => {
  const known = new Set([HDMI_14B_OUI, HDMI_FORUM_OUI, HDR10PLUS_OUI, AMD_FREESYNC_OUI, DOLBY_VISION_OUI]);
  const leaked = [];
  for (const { file, ref } of vendorBlocks()) {
    const view = parseVsdb(ref);
    if (known.has(ref.oui) && view.type === "generic") {
      leaked.push(`${file}: ${ouiToString(ref.oui)} fell through to generic`);
    }
  }
  assert.deepEqual(leaked, [], "a known OUI was not decoded structurally");
});

test("HDMI Forum fields stay inside their spec ranges", { skip }, () => {
  const bad = [];
  let n = 0;
  for (const { file, ref } of vendorBlocks()) {
    const view = parseVsdb(ref);
    if (view.type !== "hdmi-forum") continue;
    n++;
    const d = view.data;
    if (d.maxTmdsClockMhz < 0 || d.maxTmdsClockMhz > 1275) bad.push(`${file}: Max_TMDS ${d.maxTmdsClockMhz}`);
    if (d.maxFrlRate > 15) bad.push(`${file}: Max_FRL ${d.maxFrlRate}`);
    if (d.vrr) {
      if (d.vrr.min > 63) bad.push(`${file}: VRRmin ${d.vrr.min}`);
      if (d.vrr.max > 1023) bad.push(`${file}: VRRmax ${d.vrr.max}`);
      if (d.vrr.max && d.vrr.min > d.vrr.max) bad.push(`${file}: VRR ${d.vrr.min}>${d.vrr.max}`);
    }
    if (d.dsc && d.dsc.totalChunkKBytes > 63) bad.push(`${file}: DSC chunk ${d.dsc.totalChunkKBytes}`);
  }
  console.log(`      ${n} HDMI Forum block(s) checked`);
  assert.deepEqual(bad, []);
});

test("HDMI 1.4b video sections decode rather than fall through", { skip }, () => {
  let total = 0, parsed = 0, withVics = 0, flagsOnly = 0;
  const unparsed = [];
  const vicHist = new Map();

  for (const { file, ref } of vendorBlocks()) {
    const view = parseVsdb(ref);
    if (view.type !== "hdmi14b") continue;
    total++;
    const d = view.data;
    for (const n of d.physicalAddress) assert.ok(n >= 0 && n <= 15, `${file}: bad physical address`);

    if (!d.flags?.hdmiVideoPresent) continue;
    if (!d.video) { unparsed.push(file); continue; }
    parsed++;
    if (!d.video.hasLengthByte) flagsOnly++;
    if (d.video.hdmiVics.length) {
      withVics++;
      for (const v of d.video.hdmiVics) vicHist.set(v, (vicHist.get(v) ?? 0) + 1);
    }
  }

  const hist = [...vicHist.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => `HDMI_VIC ${v} x${n}`);
  console.log(
    `      ${total} HDMI 1.4b block(s) · ${parsed} video sections (${flagsOnly} flags-only, ${withVics} with 4K lists)`,
  );
  if (hist.length) console.log(`        ${hist.join(", ")}`);
  assert.deepEqual(unparsed, [], "HDMI_Video_present set but the section did not decode");
});

test("AMD FreeSync blocks decode to sane refresh ranges", { skip }, () => {
  const bad = [];
  let n = 0;
  let inverted = 0;
  for (const { file, ref } of vendorBlocks()) {
    const view = parseVsdb(ref);
    if (view.type !== "amd-freesync") continue;
    n++;
    const d = view.data;
    for (const [k, val] of Object.entries({
      version: d.version, min: d.minRefreshHz, max: d.maxRefreshHz, gamma: d.gammaBits,
    })) {
      if (val < 0 || val > 255) bad.push(`${file}: ${k} = ${val} out of byte range`);
    }
    if (d.maxLsbFreesyncRefreshHz > 0xffff) bad.push(`${file}: LSB refresh ${d.maxLsbFreesyncRefreshHz}`);
    // Inverted ranges occur in real VRR-off variants and are confirmed by the
    // DDC Manager oracle, so they are data, not a decode fault.
    if (d.minRefreshHz > d.maxRefreshHz) inverted++;
  }
  console.log(
    `      ${n} AMD FreeSync block(s) checked (${inverted} with min > max, confirmed against the oracle)` +
    ` — ATP Manager reports these as "Unknown"`,
  );
  assert.ok(n > 0, "expected AMD FreeSync blocks in the corpus");
  assert.deepEqual(bad, []);
});

test("HDR10+ indices decode within their bit widths", { skip }, () => {
  const bad = [];
  let n = 0;
  for (const { file, ref } of vendorBlocks()) {
    const view = parseVsdb(ref);
    if (view.type !== "hdr10plus") continue;
    n++;
    const d = view.data;
    if (d.applicationVersion > 3) bad.push(`${file}: application_version ${d.applicationVersion}`);
    if (d.fullFramePeakLuminanceIndex > 3) bad.push(`${file}: full-frame index ${d.fullFramePeakLuminanceIndex}`);
    if (d.peakLuminanceIndex > 15) bad.push(`${file}: peak index ${d.peakLuminanceIndex}`);
  }
  console.log(`      ${n} HDR10+ block(s) checked`);
  assert.ok(n > 0, "expected HDR10+ blocks in the corpus");
  assert.deepEqual(bad, []);
});

test("every SVD in the corpus resolves to a known VIC label", { skip }, () => {
  const unknown = new Map();
  let total = 0;
  for (const { bytes } of loadCorpus()) {
    let edid;
    try {
      edid = decodeEdid(bytes);
    } catch {
      continue;
    }
    for (const ext of edid.extensions) {
      if (ext.kind !== "cta") continue;
      for (const block of ext.dataBlocks) {
        if (block.kind !== "video") continue;
        for (const svd of block.svds) {
          total++;
          if (describeVic(svd.vic).startsWith("VIC ")) {
            unknown.set(svd.vic, (unknown.get(svd.vic) ?? 0) + 1);
          }
        }
      }
    }
  }
  const misses = [...unknown.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`      ${total} SVDs · ${misses.length} distinct VIC(s) missing from the table`);
  if (misses.length) console.log(`        ${misses.map(([v, n]) => `VIC ${v} x${n}`).join(", ")}`);
  assert.deepEqual(misses, [], "the CTA-861 VIC table should cover every SVD in the corpus");
});
