import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeEdid, asVendorBlock, parseVsdb, buildVsdb, bytesEqual, bytesToHex, ouiToString, OUI_NAMES,
} from "../packages/edid-core/dist/index.js";
import { parseEdidXml } from "../packages/edid-io/dist/index.js";

import { SAMPLES_DIR as DIR, MALFORMED, sampleFiles, skipWithoutSamples as skip } from "./fixtures.mjs";

const files = sampleFiles().filter((f) => !MALFORMED.has(f));

/** Every vendor block across the whole sample corpus. */
function collectVendorBlocks() {
  const found = [];
  for (const f of files) {
    const edid = decodeEdid(parseEdidXml(readFileSync(join(DIR, f), "utf8")));
    for (const ext of edid.extensions) {
      if (ext.kind !== "cta") continue;
      for (const block of ext.dataBlocks) {
        const ref = asVendorBlock(block);
        if (ref) found.push({ file: f, ref });
      }
    }
  }
  return found;
}

test("the corpus actually contains vendor blocks to test", { skip }, () => {
  const found = collectVendorBlocks();
  assert.ok(found.length > 0, "no vendor blocks found in the sample corpus");

  const byOui = new Map();
  for (const { ref } of found) byOui.set(ref.oui, (byOui.get(ref.oui) ?? 0) + 1);
  const summary = [...byOui.entries()]
    .map(([oui, n]) => `${ouiToString(oui)} x${n}${OUI_NAMES[oui] ? ` (${OUI_NAMES[oui]})` : ""}`)
    .join("\n        ");
  console.log(`      ${found.length} vendor blocks:\n        ${summary}`);
});

test("parse -> build reproduces every vendor payload byte-for-byte", { skip }, () => {
  for (const { file, ref } of collectVendorBlocks()) {
    const view = parseVsdb(ref);
    const rebuilt = buildVsdb(view);
    assert.ok(
      bytesEqual(ref.payload, rebuilt),
      `${file} ${ouiToString(ref.oui)} [${view.type}]\n` +
      `  in : ${bytesToHex(ref.payload)}\n  out: ${bytesToHex(rebuilt)}`,
    );
  }
});

test("HDMI Forum fields decode to sane values where present", { skip }, () => {
  let checked = 0;
  for (const { file, ref } of collectVendorBlocks()) {
    const view = parseVsdb(ref);
    if (view.type !== "hdmi-forum") continue;
    const d = view.data;
    assert.ok(d.maxTmdsClockMhz >= 0 && d.maxTmdsClockMhz <= 1275, `${file}: Max_TMDS ${d.maxTmdsClockMhz} out of range`);
    assert.ok(d.maxFrlRate >= 0 && d.maxFrlRate <= 15, `${file}: Max_FRL_Rate out of range`);
    if (d.vrr) {
      assert.ok(d.vrr.min >= 0 && d.vrr.min <= 63, `${file}: VRRmin ${d.vrr.min} out of range`);
      assert.ok(d.vrr.max >= 0 && d.vrr.max <= 1023, `${file}: VRRmax ${d.vrr.max} out of range`);
    }
    checked++;
  }
  console.log(`      checked ${checked} HDMI Forum block(s)`);
});

test("HDMI 1.4b physical addresses decode to 4 nibbles", { skip }, () => {
  let checked = 0;
  for (const { file, ref } of collectVendorBlocks()) {
    const view = parseVsdb(ref);
    if (view.type !== "hdmi14b") continue;
    assert.equal(view.data.physicalAddress.length, 4, `${file}: bad physical address`);
    for (const n of view.data.physicalAddress) {
      assert.ok(n >= 0 && n <= 15, `${file}: physical address nibble ${n} out of range`);
    }
    checked++;
  }
  console.log(`      checked ${checked} HDMI 1.4b block(s)`);
});
