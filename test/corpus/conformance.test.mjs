/**
 * Corpus conformance — the regression gate for every change to the codec.
 *
 * Tiers 1-3 need no field mapping and cover the whole corpus, so they are the
 * cheap, unambiguous signal. Tier 6 is synthesised because the corpus contains
 * no malformed EDIDs at all (every one of 1,397 files has valid checksums).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEdidDdc, serialiseEdidDdc } from "../../packages/edid-io/dist/index.js";
import {
  decodeEdid, encodeEdid, splitBlocks, isChecksumValid, bytesEqual, bytesToHex,
  hexToBytes, checksumFor, findEeodbExtensionCount,
} from "../../packages/edid-core/dist/index.js";
import {
  loadCorpus, corpusAvailable, extractOracleHex, declaredBlockCount, CORPUS_ROOT,
} from "./loader.mjs";

const available = corpusAvailable();
const skip = available ? false : `corpus not found at ${CORPUS_ROOT}`;

test("corpus is discoverable and sane", { skip }, () => {
  const corpus = loadCorpus();
  const hex = corpus.filter((c) => c.encoding === "hex").length;
  const bin = corpus.filter((c) => c.encoding === "binary").length;
  const withOracle = corpus.filter((c) => c.oracle).length;
  console.log(
    `      ${corpus.length} EDIDs (${hex} hex, ${bin} binary) · ${withOracle} with a decoded oracle`,
  );
  assert.ok(corpus.length > 0, "no .ddc files found");
  for (const c of corpus) {
    assert.equal(c.bytes.length % 128, 0, `${c.file}: not a whole number of blocks`);
  }
});

// ------------------------------------------------------------------- Tier 1

test("T1: every EDID round-trips decode -> encode byte-exactly", { skip }, () => {
  const failures = [];
  for (const { file, bytes } of loadCorpus()) {
    let encoded;
    try {
      encoded = encodeEdid(decodeEdid(bytes));
    } catch (e) {
      failures.push(`${file}: threw ${e.message}`);
      continue;
    }
    if (bytesEqual(bytes, encoded)) continue;

    const diffs = [];
    for (let i = 0; i < Math.max(bytes.length, encoded.length); i++) {
      if (bytes[i] !== encoded[i]) diffs.push(i);
    }
    const at = diffs[0];
    failures.push(
      `${file}: ${diffs.length} byte(s) differ, first at ${at} ` +
      `(block ${Math.floor(at / 128)} offset ${at % 128}): ` +
      `${(bytes[at] ?? 0).toString(16)} -> ${(encoded[at] ?? 0).toString(16)}`,
    );
  }
  assert.deepEqual(failures, [], `${failures.length} file(s) failed to round-trip`);
});

// ------------------------------------------------------------------- Tier 2

test("T2: every 128-byte block has a valid checksum", { skip }, () => {
  const bad = [];
  for (const { file, bytes } of loadCorpus()) {
    splitBlocks(bytes).forEach((b, i) => {
      if (!isChecksumValid(b)) bad.push(`${file} block ${i}`);
    });
  }
  assert.deepEqual(bad, [], `${bad.length} block(s) have invalid checksums`);
});

test("T2b: re-encoded output also has valid checksums", { skip }, () => {
  const bad = [];
  for (const { file, bytes } of loadCorpus()) {
    splitBlocks(encodeEdid(decodeEdid(bytes))).forEach((b, i) => {
      if (!isChecksumValid(b)) bad.push(`${file} block ${i}`);
    });
  }
  assert.deepEqual(bad, [], `${bad.length} re-encoded block(s) have invalid checksums`);
});

// ------------------------------------------------------------------- Tier 3

test("T3: the report hex dump is an exact prefix of the .ddc", { skip }, () => {
  const failures = [];
  let checked = 0;
  let truncatedByEeodb = 0;

  for (const { file, bytes, oracle } of loadCorpus()) {
    if (!oracle || oracle.kind !== "lecroy") continue;
    const oracleBytes = extractOracleHex(readFileSync(oracle.path, "utf8"));
    if (oracleBytes.length === 0) continue;
    checked++;

    if (oracleBytes.length > bytes.length) {
      failures.push(`${file}: report has ${oracleBytes.length} bytes, .ddc only ${bytes.length}`);
      continue;
    }
    const prefix = bytes.subarray(0, oracleBytes.length);
    if (!bytesEqual(prefix, oracleBytes)) {
      let at = 0;
      while (at < oracleBytes.length && prefix[at] === oracleBytes[at]) at++;
      failures.push(`${file}: diverges at byte ${at}`);
      continue;
    }
    // A report shorter than the file is expected when an HF-EEODB raises the
    // real block count above what base byte 126 declares.
    if (oracleBytes.length < bytes.length) truncatedByEeodb++;
  }

  console.log(
    `      ${checked} report(s) checked · ${truncatedByEeodb} cover only the blocks byte 126 declares`,
  );
  assert.deepEqual(failures, [], `${failures.length} report(s) disagree with their .ddc`);
});

/**
 * How far a report decodes is itself a check on our EEODB handling.
 *
 * Two report-generator behaviours exist in the corpus: 1,156 reports stop at
 * the count in base byte 126, and 6 follow the HF-EEODB override instead. Both
 * are legitimate; anything else would mean we mis-read one of the two counts.
 */
test("T3b: report length matches a count we decode (byte 126 or EEODB)", { skip }, () => {
  const mismatches = [];
  let stopsAtByte126 = 0;
  let followsEeodb = 0;

  for (const { file, bytes, oracle } of loadCorpus()) {
    if (!oracle || oracle.kind !== "lecroy") continue;
    const oracleBytes = extractOracleHex(readFileSync(oracle.path, "utf8"));
    if (oracleBytes.length === 0) continue;

    const byDeclared = declaredBlockCount(bytes) * 128;
    const eeodb = findEeodbExtensionCount(decodeEdid(bytes));
    const byEeodb = eeodb === null ? null : (1 + eeodb) * 128;

    if (oracleBytes.length === byDeclared) stopsAtByte126++;
    else if (byEeodb !== null && oracleBytes.length === byEeodb) followsEeodb++;
    else {
      mismatches.push(
        `${file}: report ${oracleBytes.length}B, byte126 says ${byDeclared}B, ` +
        `EEODB says ${byEeodb ?? "n/a"}`,
      );
    }
  }

  console.log(`      ${stopsAtByte126} stop at byte 126 · ${followsEeodb} follow the EEODB override`);
  assert.deepEqual(mismatches, [], "report length matched neither declared count");
});

// ------------------------------------------------------------------- Tier 6

test("T6: malformed EDIDs are rejected rather than silently accepted", () => {
  const good = hexToBytes(
    "00FFFFFFFFFFFF0063180000000000000000010480502D781A0DC9A05747982712484C200000" +
    "010101010101010101010101010101018F0AD08A20E02D10103E9600C48E21000018000000100000" +
    "000000000000000000000000000000FC00556E6B6E6F776E0A2020202020000000FD0017F1088C1E" +
    "000A2020202020200088",
  );

  // Sanity: the untouched fixture must decode and round-trip.
  assert.ok(bytesEqual(good, encodeEdid(decodeEdid(good))), "fixture should be clean");

  // Missing EDID header.
  const noHeader = Uint8Array.from(good);
  noHeader[0] = 0x01;
  assert.throws(() => decodeEdid(noHeader), /header/i);

  // Length that is not a whole number of blocks.
  assert.throws(() => decodeEdid(good.subarray(0, 100)), /multiple of 128/);

  // Empty input.
  assert.throws(() => decodeEdid(new Uint8Array(0)), /empty/i);

  // A corrupted checksum must be detected on read and repaired on write.
  const badChecksum = Uint8Array.from(good);
  badChecksum[127] ^= 0xff;
  assert.equal(isChecksumValid(badChecksum), false, "corruption should be visible");
  const repaired = encodeEdid(decodeEdid(badChecksum));
  assert.ok(isChecksumValid(repaired.subarray(0, 128)), "encode must emit a valid checksum");
  assert.equal(repaired[127], checksumFor(repaired.subarray(0, 128)));
});

test("T6b: an over-long CTA data block is refused, not truncated", { skip }, () => {
  const withCta = loadCorpus().find((c) => c.bytes.length >= 256 && c.bytes[128] === 0x02);
  assert.ok(withCta, "expected at least one CTA extension in the corpus");

  const edid = decodeEdid(withCta.bytes);
  const cta = edid.extensions.find((e) => e.kind === "cta");
  assert.ok(cta, "expected a decoded CTA extension");

  // The CTA length field is 5 bits, so a 32-byte payload cannot be represented.
  cta.dataBlocks.push({ kind: "unknown-cta", tag: 3, payload: new Uint8Array(32) });
  assert.throws(() => encodeEdid(edid), /31/);
});

// --------------------------------------------------------------- statistics

test("corpus coverage report", { skip }, () => {
  const corpus = loadCorpus();
  const blockCounts = {};
  const extTags = {};
  const oracleKinds = {};

  for (const { bytes, oracle } of corpus) {
    const n = bytes.length / 128;
    blockCounts[n] = (blockCounts[n] ?? 0) + 1;
    for (const b of splitBlocks(bytes).slice(1)) {
      const tag = "0x" + b[0].toString(16).padStart(2, "0");
      extTags[tag] = (extTags[tag] ?? 0) + 1;
    }
    const k = oracle ? oracle.kind : "none";
    oracleKinds[k] = (oracleKinds[k] ?? 0) + 1;
  }

  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ");
  console.log(`      blocks per EDID   ${fmt(blockCounts)}`);
  console.log(`      extension tags    ${fmt(extTags)}`);
  console.log(`      oracle kinds      ${fmt(oracleKinds)}`);
  assert.ok(corpus.length > 0);
});

// -------------------------------------------------------------- .ddc format

test("T7: canonical .ddc text round-trips through the writer", { skip }, () => {
  const mismatches = [];
  let hex = 0;

  for (const { file, bytes, encoding } of loadCorpus()) {
    if (encoding !== "hex") continue;   // binary captures have no canonical text
    hex++;
    const original = readFileSync(file, "utf8");
    const written = serialiseEdidDdc(bytes);
    if (written !== original) {
      mismatches.push(`${file}: ${original.length} chars in, ${written.length} out`);
    }
  }

  console.log(`      ${hex} hex .ddc file(s) re-serialise identically`);
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} file(s) changed on write`);
});

test("T7b: the reader tolerates the separators ATP Manager tolerates", { skip }, () => {
  // ATP Manager's importer scans for hex pairs and ignores everything else, so
  // a file split across lines or spaced out must read back the same bytes.
  const { bytes } = loadCorpus().find((c) => c.encoding === "hex");
  const canonical = serialiseEdidDdc(bytes);

  const spaced = canonical.match(/../g).join(" ");
  const lines = canonical.match(/.{1,32}/g).join("\n");
  const prefixed = canonical.match(/.{1,32}/g).map((l, i) => `${i * 16}: ${l}`).join("\r\n");

  for (const [name, text] of [["spaced", spaced], ["lines", lines], ["offsets", prefixed]]) {
    assert.ok(bytesEqual(parseEdidDdc(text), bytes), `${name} form did not read back identically`);
  }
});
