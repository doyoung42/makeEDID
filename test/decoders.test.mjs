import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDolbyVisionVsvdb, buildDolbyVisionVsvdb, dolbyVisionFields,
  setDolbyVisionField, dolbyVisionVariant, dolbyVisionVendorLength,
} from "../packages/edid-core/dist/vsdb/dolbyVision.js";
import {
  parseTypeVIIIOptions, buildTypeVIIIOptions, parseTypeVIIICodes, buildTypeVIIICodes,
  parseDynamicRangeLimits, buildDynamicRangeLimits, DYNAMIC_RANGE_LIMITS_LENGTH,
} from "../packages/edid-core/dist/displayidTiming.js";

/*
 * These three block types have ZERO instances in the 1,397-file corpus, so the
 * corpus round-trip suite cannot cover them. Synthetic fixtures are the only
 * verification available — the first real EDID carrying one of these is
 * effectively its first field test.
 */

// Vendor-data lengths, i.e. the block length minus tag/ext-tag/OUI.
const DV_VARIANTS = [
  ["V0", 0, 21], ["V1_15B", 1, 10], ["V1_12B", 1, 7],
  ["V2", 2, 7], ["V4_10B", 4, 5], ["V4_20B", 4, 15],
];

/** Deterministic pseudo-random payload so a failure is reproducible. */
function fill(length, seed) {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = (x >> 16) & 0xff; }
  return out;
}

test("D1: Dolby Vision variant detection uses (version, vendor length)", () => {
  for (const [name, version, length] of DV_VARIANTS) {
    assert.equal(dolbyVisionVariant(version, length), name, name);
    assert.equal(dolbyVisionVendorLength(name), length, name + " length");
  }
  // A length that belongs to another variant must not match.
  assert.equal(dolbyVisionVariant(0, 26), "unknown", "block length is not vendor length");
  assert.equal(dolbyVisionVariant(3, 7), "unknown", "version 3 is undefined");
});

test("D2: Dolby Vision parse -> build is byte-exact for every variant", () => {
  for (const [name, version, length] of DV_VARIANTS) {
    const payload = fill(length, 7 + version);
    payload[0] = ((version & 7) << 5) | (payload[0] & 0x1f);
    const view = parseDolbyVisionVsvdb(payload);
    assert.equal(view.variant, name, name);
    assert.deepEqual(Array.from(buildDolbyVisionVsvdb(view)), Array.from(payload), name);
  }
});

test("D3: every Dolby Vision field survives a write-then-read", () => {
  let checked = 0;
  for (const [name, version, length] of DV_VARIANTS) {
    const payload = fill(length, 31 + version);
    payload[0] = ((version & 7) << 5) | (payload[0] & 0x1f);
    const view = parseDolbyVisionVsvdb(payload);
    const fields = dolbyVisionFields(view);
    assert.ok(fields.length > 0, name + " decodes no fields");

    for (const f of fields) {
      // Pick a value that differs from the current one but still fits the field.
      const next = f.kind === "boolean" ? !f.value : (f.value === 0 ? 1 : 0);
      assert.ok(setDolbyVisionField(view, f.key, next), name + "." + f.key + " not writable");
      const after = dolbyVisionFields(view).find((x) => x.key === f.key);
      assert.equal(after.value, next, name + "." + f.key);
      // Every declared span must be inside the payload.
      assert.ok(f.offset + f.length <= length,
        `${name}.${f.key} span ${f.offset}+${f.length} exceeds ${length}`);
      checked++;
    }
  }
  assert.ok(checked >= 60, "expected 60+ Dolby fields, got " + checked);
});

test("D4: Dolby Vision rejects unknown field keys", () => {
  const view = parseDolbyVisionVsvdb(fill(7, 3));
  assert.equal(setDolbyVisionField(view, "nonsense", 1), false);
});

test("D5: Type VIII option bits sit at different offsets per carrier", () => {
  const o = { blockRevision: 1, codeSize: 2, supportsY420: true, codeType: 2 };
  const cta = buildTypeVIIIOptions(o, "cta");
  const did = buildTypeVIIIOptions(o, "displayid");
  assert.notEqual(cta, did, "the two carriers must not coincide for this input");
  assert.deepEqual(parseTypeVIIIOptions(cta, "cta"), o);
  assert.deepEqual(parseTypeVIIIOptions(did, "displayid"), o);
  // Spot-check the documented bit positions.
  assert.equal(cta, 0b10101001, "CTA: type 7:6, y420 5, size 3, rev 2:0");
  assert.equal(did, 0b00110101, "DisplayID: rev 7:5, type 4:3, y420 2, size 0");
});

test("D6: Type VIII codes round-trip at both code sizes", () => {
  for (const size of [1, 2]) {
    const codes = size === 1 ? [1, 7, 19, 255] : [1, 300, 65535, 0];
    const bytes = buildTypeVIIICodes(codes, size);
    assert.equal(bytes.length, codes.length * size);
    assert.deepEqual(parseTypeVIIICodes(bytes, size), codes, "size " + size);
  }
  // A trailing odd byte at size 2 is dropped, not misread.
  assert.deepEqual(parseTypeVIIICodes(Uint8Array.from([1, 0, 9]), 2), [1]);
});

test("D7: Dynamic Range Limits round-trips and stores clocks as kHz-1", () => {
  const d = {
    minPixelClockKhz: 25175, maxPixelClockKhz: 1188000,
    minRefreshRateHz: 48, maxRefreshRateHz: 144,
    seamlessDynamicVideo: true, flagsReserved: 0x05,
  };
  const bytes = buildDynamicRangeLimits(d);
  assert.equal(bytes.length, DYNAMIC_RANGE_LIMITS_LENGTH);
  assert.deepEqual(parseDynamicRangeLimits(bytes), d);
  // 25175 kHz stored as 25174 = 0x006256, little-endian.
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0x56, 0x62, 0x00]);
  assert.equal(bytes[8], 0x85, "seamless in bit 7, reserved bits preserved");
});

test("D8: Dynamic Range Limits refuses a short payload", () => {
  assert.throws(() => parseDynamicRangeLimits(new Uint8Array(8)), /needs 9 bytes/);
});
