import type { SpecField, ByteSpan } from "./flatten.js";

/**
 * Turns the flat row list into the block → sub-block → field tree the matrix
 * renders, and answers the reverse question the hex dump asks.
 *
 * `flattenEdid` stays flat on purpose: the matrix shows several models side by
 * side and has to union their rows by `path`, because different models carry
 * different blocks. Unioning flat rows and deriving one tree from the result is
 * straightforward; merging differently-shaped trees is not.
 */

export interface FieldNode {
  field: SpecField;
  depth: number;
  children: FieldNode[];
}

/**
 * Build the tree. Rows whose parent is missing attach at the root rather than
 * disappearing, so a partial row set (a union across models) still renders
 * everything it contains.
 */
export function buildFieldTree(fields: SpecField[]): FieldNode[] {
  const nodes = new Map<string, FieldNode>();
  for (const field of fields) {
    // First writer wins: a union may carry the same path from several models.
    if (!nodes.has(field.path)) nodes.set(field.path, { field, depth: 0, children: [] });
  }

  const roots: FieldNode[] = [];
  for (const field of fields) {
    const node = nodes.get(field.path)!;
    if (node.depth === -1) continue;        // already placed
    const parent = field.parent === null ? undefined : nodes.get(field.parent);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
    node.depth = -1;                        // mark placed
  }

  const assignDepth = (node: FieldNode, depth: number) => {
    node.depth = depth;
    for (const c of node.children) assignDepth(c, depth + 1);
  };
  for (const r of roots) assignDepth(r, 0);
  return roots;
}

/** Walk the tree in render order (parents before their children). */
export function flattenTree(nodes: FieldNode[], out: FieldNode[] = []): FieldNode[] {
  for (const n of nodes) {
    out.push(n);
    flattenTree(n.children, out);
  }
  return out;
}

/** Every ancestor path of `path`, nearest first. */
export function ancestorPaths(fields: SpecField[], path: string): string[] {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const out: string[] = [];
  let current = byPath.get(path)?.parent ?? null;
  while (current !== null && !out.includes(current)) {
    out.push(current);
    current = byPath.get(current)?.parent ?? null;
  }
  return out;
}

export function spanContains(span: ByteSpan, blockIndex: number, offset: number): boolean {
  return span.blockIndex === blockIndex
    && offset >= span.byteOffset
    && offset < span.byteOffset + span.byteLength;
}

/**
 * Rows covering one byte, narrowest first.
 *
 * Clicking a byte in the hex dump should select the most specific thing that
 * owns it, so the leaf comes before the sub-block that contains it.
 */
export function fieldsAtByte(fields: SpecField[], blockIndex: number, offset: number): SpecField[] {
  return fields
    .filter((f) => f.span !== null && spanContains(f.span, blockIndex, offset))
    .sort((a, b) => a.span!.byteLength - b.span!.byteLength);
}

/** Byte indices covered by a span, as absolute offsets into the whole EDID. */
export function spanBytes(span: ByteSpan, blockSize = 128): number[] {
  const start = span.blockIndex * blockSize + span.byteOffset;
  return Array.from({ length: span.byteLength }, (_, i) => start + i);
}
