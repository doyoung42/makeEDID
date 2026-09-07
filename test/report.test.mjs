import test from "node:test";
import assert from "node:assert/strict";
import { createBlankEdid } from "../packages/edid-core/dist/template.js";
import { applyField } from "../packages/edid-core/dist/applyField.js";
import { formatEdidReport } from "../packages/edid-core/dist/report.js";

/*
 * Format isn't a contract (the plain-text report can change shape), so these
 * assert on content — block headers and a known label/value pair are present
 * — rather than an exact layout.
 */

test("report: names the file and shows block checksum status", () => {
  const edid = createBlankEdid();
  const text = formatEdidReport(edid, "MY-MODEL.ddc");
  assert.match(text, /MY-MODEL\.ddc/);
  assert.match(text, /Block 0: checksum OK/);
});

test("report: an edited field's new value appears", () => {
  const edid = createBlankEdid();
  applyField(edid, "base.manufacturer", "ABC");
  applyField(edid, "base.desc2.name", "REPORT TEST");
  const text = formatEdidReport(edid);
  assert.match(text, /Manufacturer.*ABC/);
  assert.match(text, /Product Name.*REPORT TEST/);
});

test("report: does not throw on a model that no longer encodes", () => {
  const edid = createBlankEdid();
  // Force an encode failure without going through applyField's own guards.
  edid.base.descriptors = [];
  assert.doesNotThrow(() => formatEdidReport(edid, "broken"));
});

test("report: is stable text, not an object dump", () => {
  const edid = createBlankEdid();
  const text = formatEdidReport(edid);
  assert.equal(typeof text, "string");
  assert.ok(text.length > 100);
  assert.ok(!text.includes("[object Object]"));
});
