/**
 * Vendor fixture discovery for the unit tests.
 *
 * `reference/samples/` holds 30 DATAOBJ XML files that ship with the ATP
 * Manager instrument (its own "HDMI CT TEST" / "HDMI Analyzer" conformance
 * patterns). They are third-party data, so `.gitignore` keeps them out of the
 * repository by default and a fresh clone has none of them — the tests that
 * need them skip with a message instead of crashing at import time.
 *
 * Point `EDID_SAMPLES_DIR` somewhere else to use a different fixture set.
 */
import { existsSync, readdirSync } from "node:fs";

export const SAMPLES_DIR = process.env.EDID_SAMPLES_DIR ?? "reference/samples";

/** Vendor fixture with an odd-length hex payload (257 chars) in BLOCK1. */
export const MALFORMED = new Set(["DB8_H10_DTDs2.xml"]);

export function sampleFiles() {
  if (!existsSync(SAMPLES_DIR)) return [];
  return readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".xml")).sort();
}

/**
 * `false` when the fixtures are present, otherwise the reason string that
 * node:test prints beside the skipped case.
 */
export const skipWithoutSamples =
  sampleFiles().length > 0 ? false : `vendor fixtures not found at ${SAMPLES_DIR}`;
