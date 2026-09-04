import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeEdid, encodeEdid, splitBlocks, isChecksumValid, checksumFor, bytesEqual,
} from "../packages/edid-core/dist/index.js";
import { parseEdidXml, serialiseEdidXml } from "../packages/edid-io/dist/index.js";
import { SAMPLES_DIR as DIR, MALFORMED, sampleFiles, skipWithoutSamples as skip } from "./fixtures.mjs";

const files = sampleFiles();
const usable = files.filter((f) => !MALFORMED.has(f));

test("every sample parses as DATAOBJ XML", { skip }, () => {
  for (const f of usable) {
    const bytes = parseEdidXml(readFileSync(join(DIR, f), "utf8"));
    assert.equal(bytes.length % 128, 0, `${f}: not a whole number of blocks`);
  }
});

test("malformed vendor fixtures are rejected with a clear message", { skip }, () => {
  for (const f of MALFORMED) {
    assert.throws(
      () => parseEdidXml(readFileSync(join(DIR, f), "utf8")),
      /odd/,
      `${f} should be rejected for its odd-length hex`,
    );
  }
});

test("XML serialisation is stable", { skip }, () => {
  for (const f of usable) {
    const original = parseEdidXml(readFileSync(join(DIR, f), "utf8"));
    const again = parseEdidXml(serialiseEdidXml(original));
    assert.ok(bytesEqual(original, again), `${f}: bytes changed through XML`);
  }
});

test("decode -> encode is byte-exact, except for checksums the source got wrong", { skip }, () => {
  const corrected = [];

  for (const f of usable) {
    const original = parseEdidXml(readFileSync(join(DIR, f), "utf8"));
    const encoded = encodeEdid(decodeEdid(original));

    assert.equal(encoded.length, original.length, `${f}: block count changed`);

    const src = splitBlocks(original);
    const out = splitBlocks(encoded);

    for (let bi = 0; bi < src.length; bi++) {
      const sourceChecksumWasValid = isChecksumValid(src[bi]);

      for (let i = 0; i < 128; i++) {
        if (src[bi][i] === out[bi][i]) continue;

        // The one difference we accept: repairing a checksum the source had wrong.
        if (i === 127 && !sourceChecksumWasValid) {
          assert.equal(
            out[bi][i], checksumFor(out[bi]),
            `${f} block ${bi}: rewritten checksum is itself wrong`,
          );
          corrected.push(`${f} block ${bi}`);
          continue;
        }

        assert.fail(
          `${f} block ${bi} byte ${i}: ` +
          `${src[bi][i].toString(16).padStart(2, "0")} -> ${out[bi][i].toString(16).padStart(2, "0")}`,
        );
      }
    }
  }

  console.log(`      repaired ${corrected.length} invalid source checksum(s): ${corrected.join(", ")}`);
});

test("re-encoded output always has valid checksums", { skip }, () => {
  for (const f of usable) {
    const encoded = encodeEdid(decodeEdid(parseEdidXml(readFileSync(join(DIR, f), "utf8"))));
    splitBlocks(encoded).forEach((b, i) => {
      assert.ok(isChecksumValid(b), `${f} block ${i}: emitted an invalid checksum`);
    });
  }
});
