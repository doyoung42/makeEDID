import { bits, checksumFor, BLOCK_SIZE } from "./bytes.js";
import type { DisplayIdExtension, DisplayIdDataBlock } from "./types.js";

export const DISPLAYID_TAG = 0x70;

/** DisplayID 1.x data block tags (VESA DisplayID 1.3 Table 4-1). */
export const DidBlockTag = {
  ProductIdentification: 0x00,
  DisplayParameters: 0x01,
  ColorCharacteristics: 0x02,
  TimingType1Detailed: 0x03,
  TimingType2Detailed: 0x04,
  TimingType3Short: 0x05,
  TimingType4DmtId: 0x06,
  TimingTypeVesa: 0x07,
  TimingTypeCea: 0x08,
  TimingRangeLimits: 0x09,
  ProductSerialNumber: 0x0a,
  GeneralAsciiString: 0x0b,
  DisplayDeviceData: 0x0c,
  InterfacePowerSequencing: 0x0d,
  TransferCharacteristics: 0x0e,
  DisplayInterfaceData: 0x0f,
  StereoDisplayInterface: 0x10,
  TimingType5Short: 0x11,
  TiledDisplayTopology: 0x12,
  TimingType6Detailed: 0x13,
  VendorSpecific: 0x7f,
  CtaData: 0x81,
} as const;

/**
 * Decode a DisplayID section carried inside a 128-byte EDID extension block.
 *
 * Layout: [0]=0x70 [1]=version/revision [2]=section payload size
 *         [3]=primary use case [4]=extension count [5..]=data blocks
 *         then the DisplayID section checksum, then padding, then [127]=EDID checksum.
 */
export function decodeDisplayIdExtension(b: Uint8Array): DisplayIdExtension {
  const versionByte = b[1]!;
  const sectionSize = b[2]!;
  const bodyStart = 5;
  const bodyEnd = Math.min(bodyStart + sectionSize, BLOCK_SIZE - 1);

  const dataBlocks = decodeDataBlocks(b.subarray(bodyStart, bodyEnd));
  const consumed = dataBlocks.reduce((n, db) => n + 3 + db.payload.length, 0);

  return {
    kind: "displayid",
    version: bits(versionByte, 7, 4),
    revision: bits(versionByte, 3, 0),
    productType: b[3]!,
    extensionCount: b[4]!,
    sourceSectionSize: sectionSize,
    dataBlocks,
    padding: Uint8Array.from(b.subarray(bodyStart + consumed, BLOCK_SIZE - 1)),
    sectionChecksum: b[bodyEnd] ?? 0,
  };
}

function decodeDataBlocks(body: Uint8Array): DisplayIdDataBlock[] {
  const out: DisplayIdDataBlock[] = [];
  let p = 0;
  while (p + 3 <= body.length) {
    const tag = body[p]!;
    if (tag === 0x00 && body[p + 2] === 0x00) break; // zero-length padding
    const revision = body[p + 1]!;
    const length = body[p + 2]!;
    if (p + 3 + length > body.length) break;
    out.push({ tag, revision, payload: Uint8Array.from(body.subarray(p + 3, p + 3 + length)) });
    p += 3 + length;
  }
  return out;
}

export function encodeDisplayIdExtension(ext: DisplayIdExtension): Uint8Array {
  const b = new Uint8Array(BLOCK_SIZE);
  b[0] = DISPLAYID_TAG;
  b[1] = ((ext.version & 0x0f) << 4) | (ext.revision & 0x0f);
  b[3] = ext.productType;
  b[4] = ext.extensionCount;

  let p = 5;
  for (const db of ext.dataBlocks) {
    if (p + 3 + db.payload.length > BLOCK_SIZE - 1) {
      throw new Error("DisplayID data blocks overflow the 128-byte extension block");
    }
    b[p] = db.tag;
    b[p + 1] = db.revision;
    b[p + 2] = db.payload.length;
    b.set(db.payload, p + 3);
    p += 3 + db.payload.length;
  }

  // Keep the declared section size when the data blocks still fit inside it —
  // the slack is zero padding that belongs to the section, and shrinking it
  // would also move the section checksum.
  const walked = p - 5;
  const sectionSize = walked <= ext.sourceSectionSize ? ext.sourceSectionSize : walked;
  b[2] = sectionSize;

  const padLength = BLOCK_SIZE - 1 - p;
  if (padLength > 0) b.set(ext.padding.subarray(0, padLength), p);

  // DisplayID section checksum: bytes 1..(4+sectionSize) sum to 0 mod 256.
  b[5 + sectionSize] = displayIdChecksum(b, sectionSize);
  b[127] = checksumFor(b);
  return b;
}

/** Sum of the DisplayID section bytes (offset 1 through the byte before the checksum). */
export function displayIdChecksum(b: Uint8Array, sectionSize: number): number {
  let sum = 0;
  for (let i = 1; i < 5 + sectionSize; i++) sum += b[i]!;
  return (256 - (sum % 256)) % 256;
}
