import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeEdid, encodeEdid, flattenEdid, applyField, isFieldEditable, splitBlocks, isChecksumValid,
} from "../packages/edid-core/dist/index.js";
import { parseEdidXml } from "../packages/edid-io/dist/index.js";
import { SAMPLES_DIR, skipWithoutSamples as skip } from "./fixtures.mjs";

const load = (name) => decodeEdid(parseEdidXml(readFileSync(`${SAMPLES_DIR}/${name}.xml`, "utf8")));
const valueAt = (edid, path) => flattenEdid(edid).find((f) => f.path === path)?.value;

test("edits round-trip through flatten -> apply -> flatten", { skip }, () => {
  const edid = load("DB8_H1_DTDs2");
  const cases = [
    ["base.manufacturer", "SAM", "SAM"],
    ["base.productCode", 4660, 4660],
    ["base.sizeH", 80, 80],
    ["base.srgb", true, true],
    ["base.desc2.name", "MY MONITOR", "MY MONITOR"],
  ];
  for (const [path, input, expected] of cases) {
    assert.ok(applyField(edid, path, input), `${path} should be writable`);
    assert.equal(valueAt(edid, path), expected, `${path} did not take the new value`);
  }
});

test("HDMI 1.4b VSDB fields are writable and re-encode", { skip }, () => {
  const edid = load("DB8_H1_DTDs2");
  const path = flattenEdid(edid).find((f) => f.path.includes("vsdb.00-0C-03.phyAddr"))?.path;
  assert.ok(path, "expected an HDMI 1.4b VSDB in this sample");

  const base = path.replace(".phyAddr", "");
  assert.ok(applyField(edid, `${base}.phyAddr`, "2.1.0.0"));
  assert.equal(valueAt(edid, `${base}.phyAddr`), "2.1.0.0");

  assert.ok(applyField(edid, `${base}.maxTmds`, 300));
  assert.equal(valueAt(edid, `${base}.maxTmds`), 300);

  assert.ok(applyField(edid, `${base}.dc48`, true));
  assert.equal(valueAt(edid, `${base}.dc48`), true);

  // The edited EDID must still encode to valid blocks.
  for (const [i, b] of splitBlocks(encodeEdid(edid)).entries()) {
    assert.ok(isChecksumValid(b), `block ${i} checksum invalid after edits`);
  }
});

test("invalid values are rejected with a readable message", { skip }, () => {
  const edid = load("DB8_H1_DTDs2");
  assert.throws(() => applyField(edid, "base.manufacturer", "TOOLONG"), /3 letters/);
  assert.throws(() => applyField(edid, "base.productCode", 999999), /between 0 and 65535/);
  assert.throws(() => applyField(edid, "base.desc2.name", "THIS NAME IS FAR TOO LONG"), /13 characters/);
});

test("isFieldEditable agrees with what applyField accepts", { skip }, () => {
  const edid = load("DB8_H1_DTDs2");
  for (const f of flattenEdid(edid)) {
    if (!isFieldEditable(f.path)) continue;
    // Writable paths must not be rejected outright when handed their own value back.
    const ok = applyField(edid, f.path, f.value);
    assert.ok(ok, `${f.path} is advertised as editable but applyField refused it`);
  }
});

test("nothing applyField accepts is hidden by isFieldEditable", { skip }, () => {
  // The reverse direction. A path the writer takes but the gate refuses is an
  // invisible capability: the UI greys the cell out and the user never learns
  // the field is editable. `base.desc*.{name,serial,text}` sat in exactly that
  // state — accepted by applyDescriptorField, absent from every allowlist.
  const hidden = [];
  for (const f of flattenEdid(load("DB8_H1_DTDs2"))) {
    if (isFieldEditable(f.path)) continue;
    // Re-decode per probe: applyField mutates, and a stale model would let one
    // rejected write mask the next.
    const fresh = load("DB8_H1_DTDs2");
    let accepted = false;
    try {
      accepted = applyField(fresh, f.path, f.value);
    } catch {
      // Throwing means "writable, but this value is wrong" — still writable.
      accepted = true;
    }
    if (accepted) hidden.push(`${f.path} (${f.label})`);
  }
  assert.deepEqual(hidden, [], `${hidden.length} writable field(s) are greyed out by the gate`);
});

test("unknown and derived paths are refused, not silently ignored", { skip }, () => {
  const edid = load("DB8_H1_DTDs2");
  assert.equal(applyField(edid, "base.nonsense", 1), false);
  assert.equal(applyField(edid, "cta9.underscan", true), false);
  assert.equal(isFieldEditable("base.chroma.red"), false);
});
