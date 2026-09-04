import { BLOCK_SIZE } from "./bytes.js";
import { DESCRIPTOR_SIZE } from "./descriptors.js";
import { encodeDataBlock } from "./cta.js";
import { asVendorBlock } from "./vsdb/index.js";
import type { Edid, ExtensionBlock, CtaExtension, DisplayIdExtension } from "./types.js";

/**
 * Where every part of an EDID sits in the encoded bytes.
 *
 * The UI needs to answer "which bytes does this field own?" so it can highlight
 * them, and "which bytes did that edit move?" after a change. Both are computed
 * here, from the model, rather than recorded while decoding.
 *
 * That choice is deliberate. Decode-time offsets go stale the moment anything
 * is edited: `applyField` replaces a whole CTA data block with a freshly built
 * one, and if its payload changes length every following block shifts. Since
 * `encodeEdid(decodeEdid(b))` is byte-exact, the encoders are the authority on
 * position — so this module replays their layout arithmetic and asks them for
 * lengths instead of re-parsing bytes. Nothing here can disagree with the
 * encoder about framing, and no decoder or encoder had to change.
 */

/** A contiguous byte range inside one 128-byte block. */
export interface Region {
  /** 0 = base block, i + 1 = edid.extensions[i]. */
  blockIndex: number;
  /** 0..127, relative to the start of that block. */
  offset: number;
  length: number;
}

export interface EdidLayout {
  blocks: BlockLayout[];
}

export interface BlockLayout {
  kind: "base" | "cta" | "displayid" | "raw";
  whole: Region;
  checksum: Region;
  /** Base only: the four 18-byte descriptor slots. */
  descriptors?: Region[];
  cta?: CtaLayout;
  displayid?: DidLayout;
}

export interface CtaLayout {
  /** Bytes 0..3: tag, revision, DTD offset, flags. */
  header: Region;
  /** Parallel to `ext.dataBlocks`; null when the block cannot be encoded. */
  dataBlocks: (CtaBlockRegion | null)[];
  detailedTimings: Region[];
  padding: Region;
}

export interface CtaBlockRegion {
  /** Header byte plus payload. */
  whole: Region;
  /** The tag/length byte, plus the extended-tag byte when there is one. */
  header: Region;
  /** What `CtaDataBlock.payload` occupies. */
  payload: Region;
  /** For vendor blocks, the bytes `parseVsdb` sees (payload past the OUI). */
  vendorPayload: Region | null;
}

export interface DidLayout {
  /** Bytes 0..4. */
  header: Region;
  dataBlocks: DidBlockRegion[];
  sectionChecksum: Region;
  /** Padding between the last data block and the section checksum. */
  paddingBefore: Region;
  /** Padding after the section checksum, up to the block checksum. */
  paddingAfter: Region;
}

export interface DidBlockRegion {
  whole: Region;
  /** Tag, revision, length. */
  header: Region;
  payload: Region;
}

const region = (blockIndex: number, offset: number, length: number): Region =>
  ({ blockIndex, offset, length });

export function computeLayout(edid: Edid): EdidLayout {
  const blocks: BlockLayout[] = [baseLayout()];
  edid.extensions.forEach((ext, i) => blocks.push(extensionLayout(ext, i + 1)));
  return { blocks };
}

function baseLayout(): BlockLayout {
  return {
    kind: "base",
    whole: region(0, 0, BLOCK_SIZE),
    checksum: region(0, BLOCK_SIZE - 1, 1),
    // encodeBaseBlock writes slot i at 54 + i * 18.
    descriptors: [0, 1, 2, 3].map((i) => region(0, 54 + i * DESCRIPTOR_SIZE, DESCRIPTOR_SIZE)),
  };
}

function extensionLayout(ext: ExtensionBlock, blockIndex: number): BlockLayout {
  const base: BlockLayout = {
    kind: ext.kind === "cta" ? "cta" : ext.kind === "displayid" ? "displayid" : "raw",
    whole: region(blockIndex, 0, BLOCK_SIZE),
    checksum: region(blockIndex, BLOCK_SIZE - 1, 1),
  };
  if (ext.kind === "cta") base.cta = ctaLayout(ext, blockIndex);
  else if (ext.kind === "displayid") base.displayid = didLayout(ext, blockIndex);
  return base;
}

/** Mirrors encodeCtaExtension: data blocks from byte 4, then DTDs, then padding. */
function ctaLayout(ext: CtaExtension, blockIndex: number): CtaLayout {
  const header = region(blockIndex, 0, 4);

  // Revision 1 and 2 carry no data block collection at all.
  if (ext.revision < 3) {
    return {
      header,
      dataBlocks: [],
      detailedTimings: [],
      padding: region(blockIndex, 4, BLOCK_SIZE - 5),
    };
  }

  const dataBlocks: (CtaBlockRegion | null)[] = [];
  let p = 4;

  for (const block of ext.dataBlocks) {
    let encodedLength: number;
    try {
      encodedLength = encodeDataBlock(block).length;
    } catch {
      // Over-long payload: the encoder would refuse it, so we cannot place it
      // or anything after it. Report the rest as unknown rather than guessing.
      dataBlocks.push(null);
      continue;
    }
    if (p + encodedLength > BLOCK_SIZE - 1) {
      dataBlocks.push(null);
      continue;
    }

    // Extended-tag blocks spend one payload byte on the tag; vendor blocks
    // spend three on the OUI. asVendorBlock already knows which carrier is in
    // use, so the vendor payload offset follows from it.
    const headerLength = block.kind === "extended" ? 2 : 1;
    const ref = asVendorBlock(block);
    const vendorOffset = block.kind === "vendor-specific" ? 4 : 5;

    dataBlocks.push({
      whole: region(blockIndex, p, encodedLength),
      header: region(blockIndex, p, headerLength),
      payload: region(blockIndex, p + headerLength, encodedLength - headerLength),
      vendorPayload: ref
        ? region(blockIndex, p + vendorOffset, Math.max(0, encodedLength - vendorOffset))
        : null,
    });
    p += encodedLength;
  }

  const detailedTimings: Region[] = [];
  for (const _ of ext.detailedTimings) {
    if (p + DESCRIPTOR_SIZE > BLOCK_SIZE - 1) break;
    detailedTimings.push(region(blockIndex, p, DESCRIPTOR_SIZE));
    p += DESCRIPTOR_SIZE;
  }

  return {
    header,
    dataBlocks,
    detailedTimings,
    padding: region(blockIndex, p, Math.max(0, BLOCK_SIZE - 1 - p)),
  };
}

/** Mirrors encodeDisplayIdExtension: 5-byte header, then tag/rev/len blocks. */
function didLayout(ext: DisplayIdExtension, blockIndex: number): DidLayout {
  const dataBlocks: DidBlockRegion[] = [];
  let p = 5;

  for (const db of ext.dataBlocks) {
    const length = 3 + db.payload.length;
    if (p + length > BLOCK_SIZE - 1) break;
    dataBlocks.push({
      whole: region(blockIndex, p, length),
      header: region(blockIndex, p, 3),
      payload: region(blockIndex, p + 3, db.payload.length),
    });
    p += length;
  }

  const walked = p - 5;
  const sectionSize = walked <= ext.sourceSectionSize ? ext.sourceSectionSize : walked;
  const checksumOffset = 5 + sectionSize;

  return {
    header: region(blockIndex, 0, 5),
    dataBlocks,
    sectionChecksum: region(blockIndex, checksumOffset, 1),
    paddingBefore: region(blockIndex, p, Math.max(0, checksumOffset - p)),
    paddingAfter: region(blockIndex, checksumOffset + 1,
      Math.max(0, BLOCK_SIZE - 1 - (checksumOffset + 1))),
  };
}

/** Absolute byte index of a region's first byte within a whole EDID. */
export function absoluteOffset(r: Region): number {
  return r.blockIndex * BLOCK_SIZE + r.offset;
}

export function regionContains(r: Region, blockIndex: number, offset: number): boolean {
  return r.blockIndex === blockIndex && offset >= r.offset && offset < r.offset + r.length;
}
