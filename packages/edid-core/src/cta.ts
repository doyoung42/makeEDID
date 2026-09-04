import { bits, bit, checksumFor, BLOCK_SIZE } from "./bytes.js";
import { decodeDetailedTiming, encodeDetailedTiming, DESCRIPTOR_SIZE } from "./descriptors.js";
import type {
  CtaExtension, CtaDataBlock, ShortVideoDescriptor, ShortAudioDescriptor, DetailedTimingDescriptor,
} from "./types.js";

export const CTA_TAG = 0x02;

/** CTA-861 data block collection tags (byte0 bits 7..5). */
export const CtaBlockTag = {
  Audio: 1,
  Video: 2,
  VendorSpecific: 3,
  SpeakerAllocation: 4,
  VesaDtc: 5,
  Extended: 7,
} as const;

/** Extended tag codes (byte1 when tag === 7). */
export const CtaExtendedTag = {
  VideoCapability: 0,
  VendorSpecificVideo: 1,
  VesaDisplayDevice: 2,
  Colorimetry: 5,
  HdrStaticMetadata: 6,
  HdrDynamicMetadata: 7,
  NativeVideoResolution: 8,
  VideoFormatPreference: 13,
  Ycbcr420Video: 14,
  Ycbcr420CapabilityMap: 15,
  VendorSpecificAudio: 17,
  RoomConfiguration: 19,
  SpeakerLocation: 20,
  InfoFrame: 32,
  /** HDMI Forum EDID Extension Override — carries the real extension block count. */
  HdmiForumEeodb: 0x78,
  /** HDMI Forum Sink Capability Data Block. */
  HdmiForumScdb: 0x79,
} as const;

export function decodeCtaExtension(b: Uint8Array): CtaExtension {
  const revision = b[1]!;
  const dtdOffset = b[2]!;
  const flags = b[3]!;

  const ext: CtaExtension = {
    kind: "cta",
    revision,
    underscanSupported: bit(flags, 7),
    basicAudioSupported: bit(flags, 6),
    ycbcr444Supported: bit(flags, 5),
    ycbcr422Supported: bit(flags, 4),
    nativeDtdCount: bits(flags, 3, 0),
    sourceDtdOffset: dtdOffset,
    dataBlocks: [],
    detailedTimings: [],
    padding: new Uint8Array(0),
  };

  // Revision 1 has no data block collection; offset 0 means neither DBC nor DTDs.
  if (revision < 3 || dtdOffset === 0) {
    ext.padding = Uint8Array.from(b.subarray(4, BLOCK_SIZE - 1));
    return ext;
  }

  ext.dataBlocks = decodeDataBlocks(b.subarray(4, dtdOffset));

  // DTDs run from dtdOffset until a zero pixel clock or the checksum byte.
  let p = dtdOffset;
  while (p + DESCRIPTOR_SIZE <= BLOCK_SIZE - 1) {
    const slice = b.subarray(p, p + DESCRIPTOR_SIZE);
    if (slice[0] === 0 && slice[1] === 0) break;
    ext.detailedTimings.push(decodeDetailedTiming(slice));
    p += DESCRIPTOR_SIZE;
  }
  ext.padding = Uint8Array.from(b.subarray(p, BLOCK_SIZE - 1));
  return ext;
}

function decodeDataBlocks(dbc: Uint8Array): CtaDataBlock[] {
  const out: CtaDataBlock[] = [];
  let p = 0;
  while (p < dbc.length) {
    const header = dbc[p]!;
    const tag = bits(header, 7, 5);
    const length = bits(header, 4, 0);   // payload length, excluding the header byte
    if (length === 0 && tag === 0) break; // padding
    const payload = dbc.subarray(p + 1, p + 1 + length);
    out.push(decodeDataBlock(tag, payload));
    p += 1 + length;
  }
  return out;
}

function decodeDataBlock(tag: number, payload: Uint8Array): CtaDataBlock {
  switch (tag) {
    case CtaBlockTag.Video:
      return { kind: "video", svds: Array.from(payload, decodeSvd) };
    case CtaBlockTag.Audio:
      return { kind: "audio", sads: decodeSads(payload) };
    case CtaBlockTag.SpeakerAllocation:
      return { kind: "speaker-allocation", allocation: payload[0] ?? 0, raw: Uint8Array.from(payload) };
    case CtaBlockTag.VendorSpecific: {
      // OUI is little-endian in EDID; expose as a 24-bit big-endian value.
      const oui = ((payload[2] ?? 0) << 16) | ((payload[1] ?? 0) << 8) | (payload[0] ?? 0);
      return { kind: "vendor-specific", oui, payload: Uint8Array.from(payload.subarray(3)) };
    }
    case CtaBlockTag.Extended:
      return {
        kind: "extended",
        extendedTag: payload[0] ?? 0,
        payload: Uint8Array.from(payload.subarray(1)),
      };
    default:
      return { kind: "unknown-cta", tag, payload: Uint8Array.from(payload) };
  }
}

function decodeSvd(byte: number): ShortVideoDescriptor {
  // VICs 1..64 use bit7 as the "native" flag; 65..127 and 129..255 do not.
  const value = byte & 0x7f;
  if (value >= 1 && value <= 64) return { vic: value, native: bit(byte, 7) };
  return { vic: byte, native: false };
}

function encodeSvd(svd: ShortVideoDescriptor): number {
  if (svd.vic >= 1 && svd.vic <= 64) return (svd.native ? 0x80 : 0) | (svd.vic & 0x7f);
  return svd.vic & 0xff;
}

function decodeSads(payload: Uint8Array): ShortAudioDescriptor[] {
  const out: ShortAudioDescriptor[] = [];
  for (let i = 0; i + 2 < payload.length; i += 3) {
    const b0 = payload[i]!;
    out.push({
      format: bits(b0, 6, 3),
      maxChannels: bits(b0, 2, 0) + 1,
      sampleRates: payload[i + 1]! & 0x7f,
      byte3: payload[i + 2]!,
    });
  }
  return out;
}

function encodeSad(sad: ShortAudioDescriptor): number[] {
  return [
    ((sad.format & 0x0f) << 3) | ((sad.maxChannels - 1) & 0x07),
    sad.sampleRates & 0x7f,
    sad.byte3 & 0xff,
  ];
}

/** Serialise a data block back to its on-wire bytes, header included. */
export function encodeDataBlock(block: CtaDataBlock): Uint8Array {
  let tag: number;
  let payload: number[];

  switch (block.kind) {
    case "video":
      tag = CtaBlockTag.Video;
      payload = block.svds.map(encodeSvd);
      break;
    case "audio":
      tag = CtaBlockTag.Audio;
      payload = block.sads.flatMap(encodeSad);
      break;
    case "speaker-allocation":
      tag = CtaBlockTag.SpeakerAllocation;
      payload = Array.from(block.raw);
      break;
    case "vendor-specific":
      tag = CtaBlockTag.VendorSpecific;
      payload = [
        block.oui & 0xff,
        (block.oui >> 8) & 0xff,
        (block.oui >> 16) & 0xff,
        ...Array.from(block.payload),
      ];
      break;
    case "extended":
      tag = CtaBlockTag.Extended;
      payload = [block.extendedTag & 0xff, ...Array.from(block.payload)];
      break;
    case "unknown-cta":
      tag = block.tag;
      payload = Array.from(block.payload);
      break;
  }

  if (payload.length > 31) {
    throw new Error(`CTA data block payload is ${payload.length} bytes; the 5-bit length field allows at most 31`);
  }
  return Uint8Array.from([((tag & 0x07) << 5) | (payload.length & 0x1f), ...payload]);
}

export function encodeCtaExtension(ext: CtaExtension): Uint8Array {
  const b = new Uint8Array(BLOCK_SIZE);
  b[0] = CTA_TAG;
  b[1] = ext.revision;
  b[3] =
    (ext.underscanSupported ? 0x80 : 0) |
    (ext.basicAudioSupported ? 0x40 : 0) |
    (ext.ycbcr444Supported ? 0x20 : 0) |
    (ext.ycbcr422Supported ? 0x10 : 0) |
    (ext.nativeDtdCount & 0x0f);

  if (ext.revision < 3) {
    b.set(ext.padding.subarray(0, BLOCK_SIZE - 5), 4);
    b[2] = 0;
    b[127] = checksumFor(b);
    return b;
  }

  let p = 4;
  for (const block of ext.dataBlocks) {
    const encoded = encodeDataBlock(block);
    if (p + encoded.length > BLOCK_SIZE - 1) {
      throw new Error("CTA data block collection overflows the 128-byte extension block");
    }
    b.set(encoded, p);
    p += encoded.length;
  }

  // With content present, byte 2 is the offset just past the data block collection.
  // With nothing present, keep whatever the source declared (0 and 4 both occur).
  const hasContent = ext.dataBlocks.length > 0 || ext.detailedTimings.length > 0;
  b[2] = hasContent ? p : ext.sourceDtdOffset;

  for (const dtd of ext.detailedTimings) {
    if (p + DESCRIPTOR_SIZE > BLOCK_SIZE - 1) {
      throw new Error("CTA detailed timings overflow the 128-byte extension block");
    }
    b.set(encodeDetailedTiming(dtd), p);
    p += DESCRIPTOR_SIZE;
  }

  // Remaining space is padding; reuse the captured bytes so unmodified blocks round-trip.
  const padLength = BLOCK_SIZE - 1 - p;
  if (padLength > 0) b.set(ext.padding.subarray(0, padLength), p);

  b[127] = checksumFor(b);
  return b;
}

export type { DetailedTimingDescriptor };
