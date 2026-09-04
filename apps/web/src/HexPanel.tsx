import { useMemo } from "react";
import type { SpecField, ByteSpan } from "@edid/core";
import { isChecksumValid, fieldsAtByte } from "@edid/core";

/**
 * Byte view for the focused model, docked under the matrix.
 *
 * The point of putting it here rather than behind a tab is that an edit should
 * be visibly located: selecting a field highlights its bytes, the sub-block it
 * belongs to, and the block that contains it — the same "narrow to wide" cue
 * ATP Manager gives through its ByteDisplay/IByteSelector pair.
 */

const BLOCK_SIZE = 128;
const COLUMNS = 16;

export interface HexPanelProps {
  name: string;
  bytes: Uint8Array;
  /** Bytes as they were when the file was loaded, for the "changed" tint. */
  originalBytes: Uint8Array | null;
  fields: SpecField[];
  /** Path of the selected row, if any. */
  selectedPath: string | null;
  /** Absolute byte indices to flash after the most recent edit. */
  flashBytes: Set<number>;
  onSelectPath: (path: string) => void;
}

interface ByteClass {
  /** The selected field's own bytes. */
  field: Set<number>;
  /** The enclosing sub-block. */
  group: Set<number>;
  /** The enclosing 128-byte block. */
  block: Set<number>;
}

function spanToAbsolute(span: ByteSpan, into: Set<number>): void {
  const start = span.blockIndex * BLOCK_SIZE + span.byteOffset;
  for (let i = 0; i < span.byteLength; i++) into.add(start + i);
}

/** Work out which bytes belong to the selection at each level of the hierarchy. */
function classify(fields: SpecField[], selectedPath: string | null): ByteClass {
  const empty: ByteClass = { field: new Set(), group: new Set(), block: new Set() };
  if (!selectedPath) return empty;

  const byPath = new Map(fields.map((f) => [f.path, f]));
  const selected = byPath.get(selectedPath);
  if (!selected) return empty;

  const out: ByteClass = { field: new Set(), group: new Set(), block: new Set() };
  if (selected.span) spanToAbsolute(selected.span, out.field);

  // Walk up the tree: the nearest ancestor with a span is the sub-block, and
  // the outermost one is the physical block.
  const ancestors: SpecField[] = [];
  let current = selected.parent;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    const node = byPath.get(current);
    if (!node) break;
    ancestors.push(node);
    current = node.parent;
  }

  const withSpan = ancestors.filter((a) => a.span);
  const nearest = withSpan[0];
  const outermost = withSpan[withSpan.length - 1];
  if (nearest?.span) spanToAbsolute(nearest.span, out.group);
  if (outermost?.span) spanToAbsolute(outermost.span, out.block);

  return out;
}

export function HexPanel(props: HexPanelProps) {
  const { name, bytes, originalBytes, fields, selectedPath, flashBytes, onSelectPath } = props;

  const marks = useMemo(() => classify(fields, selectedPath), [fields, selectedPath]);

  const changed = useMemo(() => {
    const set = new Set<number>();
    if (!originalBytes) return set;
    const n = Math.max(bytes.length, originalBytes.length);
    for (let i = 0; i < n; i++) if (bytes[i] !== originalBytes[i]) set.add(i);
    return set;
  }, [bytes, originalBytes]);

  const blockCount = Math.ceil(bytes.length / BLOCK_SIZE);

  return (
    <div className="hexpanel">
      <div className="hex-head">
        <strong>{name}</strong>
        <span className="dim">{blockCount} block(s) · {bytes.length} bytes</span>
        {changed.size > 0 && <span className="badge dirty">{changed.size} byte(s) changed</span>}
        {selectedPath && <span className="dim sel-path">{selectedPath}</span>}
      </div>

      <div className="hex-scroll">
        {Array.from({ length: blockCount }, (_, b) => {
          const block = bytes.subarray(b * BLOCK_SIZE, (b + 1) * BLOCK_SIZE);
          const ok = block.length === BLOCK_SIZE && isChecksumValid(block);
          const inBlock = marks.block.size > 0 && marks.block.has(b * BLOCK_SIZE);
          return (
            <div className={`hex-block${inBlock ? " active" : ""}`} key={b}>
              <div className="hex-block-head">
                <span>BLOCK {b}</span>
                <span className={ok ? "chk-ok" : "chk-bad"}>{ok ? "checksum OK" : "checksum INVALID"}</span>
              </div>
              {Array.from({ length: Math.ceil(block.length / COLUMNS) }, (_, r) => (
                <div className="hex-row" key={r}>
                  <span className="hex-offset">{(r * COLUMNS).toString(16).padStart(2, "0").toUpperCase()}</span>
                  {Array.from({ length: COLUMNS }, (_, c) => {
                    const off = r * COLUMNS + c;
                    if (off >= block.length) return <span className="hex-byte pad" key={c} />;
                    const abs = b * BLOCK_SIZE + off;
                    const cls = [
                      "hex-byte",
                      marks.field.has(abs) ? "sel-field" : marks.group.has(abs) ? "sel-group" : "",
                      changed.has(abs) ? "changed" : "",
                      flashBytes.has(abs) ? "flash" : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <span
                        className={cls}
                        key={c}
                        title={`block ${b} offset ${off} (0x${off.toString(16)})`}
                        onClick={() => {
                          const owners = fieldsAtByte(fields, b, off);
                          if (owners[0]) onSelectPath(owners[0].path);
                        }}
                      >
                        {block[off]!.toString(16).padStart(2, "0").toUpperCase()}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
