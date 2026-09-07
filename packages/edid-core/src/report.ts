import type { Edid } from "./types.js";
import { flattenEdid } from "./flatten.js";
import { isChecksumValid, splitBlocks } from "./bytes.js";
import { buildFieldTree, flattenTree } from "./fieldTree.js";
import { encodeEdid } from "./codec.js";

/**
 * A plain-text decode report — the ".txt" export.
 *
 * Reuses the exact same tree the matrix renders (`buildFieldTree`/`flattenTree`),
 * so the report always matches what the UI shows; there is no second field walk
 * to fall out of sync.
 *
 * The format is deliberately not specified as a contract — it may change. Tests
 * assert on content (block headers, a known label/value pair), not layout.
 */
export function formatEdidReport(edid: Edid, name = "EDID"): string {
  const lines: string[] = [];
  lines.push(`EDID Workbench decode report — ${name}`);
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");

  let bytes: Uint8Array | null = null;
  try { bytes = encodeEdid(edid); } catch { /* still report the fields we can read */ }

  if (bytes) {
    const blocks = splitBlocks(bytes);
    lines.push(`${blocks.length} block(s), ${bytes.length} bytes total`);
    blocks.forEach((b, i) => {
      lines.push(`  Block ${i}: checksum ${isChecksumValid(b) ? "OK" : "INVALID"}`);
    });
    lines.push("");
  }

  const fields = flattenEdid(edid, bytes ?? undefined);
  const tree = flattenTree(buildFieldTree(fields));

  for (const node of tree) {
    const indent = "  ".repeat(node.depth);
    const f = node.field;
    if (f.role === "field") {
      lines.push(`${indent}${f.label}: ${formatValue(f.value)}`);
    } else {
      // Block/group rows carry their own summary as `value` (e.g. "3 SVD(s)").
      const summary = f.value === null || f.value === "" ? "" : `  — ${formatValue(f.value)}`;
      lines.push(`${indent}${f.label}${summary}`);
    }
  }

  return lines.join("\n") + "\n";
}

function formatValue(v: string | number | boolean | null): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
