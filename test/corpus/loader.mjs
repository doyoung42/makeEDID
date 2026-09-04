/**
 * Discovery and loading for the DDC ground-truth corpus.
 *
 * The corpus is 1,397 real monitor EDIDs captured from shipping panels, most of
 * them paired with a decoded report that acts as an independent oracle. Paths
 * contain spaces, parentheses, "+" and Korean text, and nesting depth varies by
 * model, so discovery is a recursive walk rather than a fixed-depth glob.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { readEdidDdc } from "../../packages/edid-io/dist/index.js";

export const CORPUS_ROOT = process.env.EDID_CORPUS_ROOT ?? "corpus";

export function findDdcFiles(root = CORPUS_ROOT) {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith(".ddc")) out.push(p);
    }
  })(root);
  return out.sort();
}

/**
 * Read one .ddc as EDID bytes. 1,382 files are contiguous uppercase hex; 15
 * (all legacy competitor captures) are raw binary.
 *
 * The parsing itself lives in @edid/io so the app and the tests agree on what a
 * .ddc is; running it over all 1,397 corpus files is that parser's regression.
 */
export function loadDdc(file) {
  try {
    return readEdidDdc(new Uint8Array(readFileSync(file)));
  } catch (e) {
    throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Locate the decoded report that accompanies a .ddc, in preference order.
 * `_report.html` / `.htm` are Teledyne LeCroy; `.txt` / `_Origin.txt` are the
 * DDC Manager tool, which prints raw field codes rather than decoded strings.
 */
export function findOracle(ddcPath) {
  const dir = dirname(ddcPath);
  const base = basename(ddcPath, extname(ddcPath));
  const candidates = [
    { path: join(dir, `${base}_report.html`), kind: "lecroy" },
    { path: join(dir, `${base}.htm`), kind: "lecroy" },
    { path: join(dir, `${base}.txt`), kind: "ddcmgr" },
    { path: join(dir, `${base}_Origin.txt`), kind: "ddcmgr" },
    { path: join(dir, `${base}.xml`), kind: "dataobj" },
  ];
  for (const c of candidates) if (existsSync(c.path)) return c;
  return null;
}

/**
 * Pull the hex dump out of a LeCroy report.
 *
 * Rows look like:
 *   <tr><td class="subhdr right">00</td><td>00</td><td>FF</td>...16 cells...</tr>
 * The leading `subhdr` cell is the row offset and must not be mistaken for data.
 *
 * Note the report only dumps `EDID[0x7E] + 1` blocks, so for EDIDs carrying an
 * HF-EEODB this is a *prefix* of the .ddc, not the whole file.
 */
export function extractOracleHex(html) {
  const bytes = [];
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    if (!row.includes("subhdr")) continue;
    // Drop the offset cell, then take every plain two-hex-digit cell.
    const body = row.replace(/<td class="subhdr[^"]*">[0-9A-Fa-f]+<\/td>/i, "");
    for (const m of body.matchAll(/<td>([0-9A-Fa-f]{2})<\/td>/g)) {
      bytes.push(parseInt(m[1], 16));
    }
  }
  return Uint8Array.from(bytes);
}

/** Blocks the base EDID declares — what a LeCroy report will actually decode. */
export function declaredBlockCount(bytes) {
  return 1 + (bytes[126] ?? 0);
}

/** Load every .ddc once, with its oracle resolved. Cached across test files. */
let cache = null;
export function loadCorpus() {
  if (cache) return cache;
  const files = findDdcFiles();
  cache = files.map((file) => {
    const { bytes, encoding } = loadDdc(file);
    return { file, bytes, encoding, oracle: findOracle(file) };
  });
  return cache;
}

export function corpusAvailable() {
  return existsSync(CORPUS_ROOT) && findDdcFiles().length > 0;
}
