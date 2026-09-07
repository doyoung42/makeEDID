import test from "node:test";
import assert from "node:assert/strict";
import {
  hdrMaxAvgLuminanceCdm2, hdrMaxAvgLuminanceCode,
  hdrMinLuminanceCdm2, hdrMinLuminanceCode,
} from "../packages/edid-core/dist/index.js";

/*
 * Formula source: reference/decompiled/.../hdr/HdrStaticMetadataBlock.java,
 * `luminance(Lum)`. Max/Avg: 50 * 2^(CV/32). Min: MaxLuminance * (CV/255)^2 / 100.
 */

test("HDR: known code points decode to the documented cd/m2 values", () => {
  assert.equal(hdrMaxAvgLuminanceCdm2(0), 50);
  assert.equal(hdrMaxAvgLuminanceCdm2(32), 100);
  assert.equal(hdrMaxAvgLuminanceCdm2(64), 200);
  // CV=255 is the corpus-typical "1000 nits" mastering display ceiling ballpark.
  assert.ok(hdrMaxAvgLuminanceCdm2(255) > 10000, "CV=255 should be very bright");
});

test("HDR: max/avg encode is the exact inverse of decode", () => {
  for (const cv of [0, 1, 32, 64, 100, 200, 254, 255]) {
    const cdm2 = hdrMaxAvgLuminanceCdm2(cv);
    assert.equal(hdrMaxAvgLuminanceCode(cdm2), cv, "cv=" + cv);
  }
});

test("HDR: min luminance depends on the sibling max code", () => {
  // CV=255 for min, at max code that gives 1000 cd/m2, should recover ~1000*1 = 1000? no:
  // (255/255)^2/100 = 0.01, so min = max * 0.01.
  const maxCode = hdrMaxAvgLuminanceCode(1000);
  const min = hdrMinLuminanceCdm2(255, maxCode);
  assert.ok(Math.abs(min - 10) < 0.5, "min should be ~1% of max at CV=255, got " + min);

  assert.equal(hdrMinLuminanceCdm2(0, maxCode), 0);
});

test("HDR: min encode is the exact inverse of decode, given the same max code", () => {
  const maxCode = 200;
  for (const cv of [0, 10, 64, 128, 200, 255]) {
    const cdm2 = hdrMinLuminanceCdm2(cv, maxCode);
    assert.equal(hdrMinLuminanceCode(cdm2, maxCode), cv, "cv=" + cv);
  }
});

test("HDR: codes are clamped to 0-255", () => {
  assert.equal(hdrMaxAvgLuminanceCode(0.001), 0);   // absurdly dim clamps to 0
  assert.equal(hdrMaxAvgLuminanceCode(1e9), 255);    // absurdly bright clamps to 255
});

test("HDR: invalid inputs throw rather than producing NaN/Infinity", () => {
  assert.throws(() => hdrMaxAvgLuminanceCode(0));
  assert.throws(() => hdrMaxAvgLuminanceCode(-5));
  assert.throws(() => hdrMinLuminanceCode(-1, 100));
  // Max code 0 is a legitimate value (50 cd/m2, since 50*2^0=50) — not "unset".
  assert.doesNotThrow(() => hdrMinLuminanceCode(10, 0));
});
