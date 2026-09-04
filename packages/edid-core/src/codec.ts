import { splitBlocks, concatBlocks } from "./bytes.js";
import { decodeBaseBlock, encodeBaseBlock, hasEdidHeader } from "./base.js";
import { decodeCtaExtension, encodeCtaExtension, CTA_TAG, CtaExtendedTag } from "./cta.js";
import { decodeDisplayIdExtension, encodeDisplayIdExtension, DISPLAYID_TAG } from "./displayid.js";
import type { Edid, ExtensionBlock } from "./types.js";

export function decodeEdid(data: Uint8Array): Edid {
  const blocks = splitBlocks(data);
  const first = blocks[0];
  if (!first) throw new Error("EDID is empty");
  if (!hasEdidHeader(first)) throw new Error("missing EDID header (00 FF FF FF FF FF FF 00)");

  return {
    base: decodeBaseBlock(first),
    extensions: blocks.slice(1).map(decodeExtension),
  };
}

function decodeExtension(b: Uint8Array): ExtensionBlock {
  switch (b[0]) {
    case CTA_TAG:       return decodeCtaExtension(b);
    case DISPLAYID_TAG: return decodeDisplayIdExtension(b);
    default:            return { kind: "raw", tag: b[0] ?? 0, raw: Uint8Array.from(b) };
  }
}

/**
 * Extension block count declared by an HDMI Forum EEODB, or null when absent.
 *
 * HDMI 2.1 keeps base byte 126 at 1 for legacy sources and puts the real count
 * in the EEODB, so byte 126 must NOT be re-derived from the physical block
 * count when an EEODB is present — doing so corrupts the EDID.
 */
export function findEeodbExtensionCount(edid: Edid): number | null {
  for (const ext of edid.extensions) {
    if (ext.kind !== "cta") continue;
    for (const block of ext.dataBlocks) {
      if (block.kind === "extended" && block.extendedTag === CtaExtendedTag.HdmiForumEeodb) {
        return block.payload[0] ?? null;
      }
    }
  }
  return null;
}

export function encodeEdid(edid: Edid): Uint8Array {
  // With an EEODB the base block keeps its declared (legacy) count verbatim;
  // without one, byte 126 tracks the blocks we actually emit.
  const base = findEeodbExtensionCount(edid) === null
    ? { ...edid.base, extensionCount: edid.extensions.length }
    : edid.base;

  const blocks: Uint8Array[] = [encodeBaseBlock(base)];
  for (const ext of edid.extensions) blocks.push(encodeExtension(ext));
  return concatBlocks(blocks);
}

function encodeExtension(ext: ExtensionBlock): Uint8Array {
  switch (ext.kind) {
    case "cta":       return encodeCtaExtension(ext);
    case "displayid": return encodeDisplayIdExtension(ext);
    case "raw":       return Uint8Array.from(ext.raw);
  }
}
