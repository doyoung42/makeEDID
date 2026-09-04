/** Structured EDID model. Every node keeps its source bytes so that
 *  decode -> encode is byte-exact even for regions we do not model. */

export interface Edid {
  base: BaseBlock;
  extensions: ExtensionBlock[];
}

// ---------------------------------------------------------------- base block

export interface BaseBlock {
  manufacturerId: string;      // 3-letter PnP ID, e.g. "SAM"
  productCode: number;         // 16-bit LE
  serialNumber: number;        // 32-bit LE
  manufactureWeek: number;
  manufactureYear: number;     // absolute year
  modelYearFlag: boolean;      // week == 0xFF -> year is model year
  edidVersion: number;
  edidRevision: number;
  videoInput: VideoInput;
  horizontalSizeCm: number;    // 0 when undefined / aspect-ratio encoded
  verticalSizeCm: number;
  gammaRaw: number;            // 0xFF = defined by DI-EXT
  features: FeatureSupport;
  chromaticity: Chromaticity;
  establishedTimings: EstablishedTimings;
  standardTimings: (StandardTiming | null)[];  // always length 8
  descriptors: Descriptor[];                   // always length 4
  extensionCount: number;
}

export type VideoInput = DigitalInput | AnalogInput;

export interface DigitalInput {
  kind: "digital";
  bitDepth: number;            // 0 = undefined, else 6/8/10/12/14/16
  videoInterface: number;      // 0=undefined 1=DVI 2=HDMIa 3=HDMIb 4=MDDI 5=DisplayPort
}

export interface AnalogInput {
  kind: "analog";
  signalLevel: number;
  setupBlankToBlack: boolean;
  separateSyncSupported: boolean;
  compositeSyncSupported: boolean;
  syncOnGreenSupported: boolean;
  vsyncSerrated: boolean;
}

export interface FeatureSupport {
  standbySupported: boolean;
  suspendSupported: boolean;
  activeOffSupported: boolean;
  colorType: number;           // analog: 0..3 ; digital: colour encoding bits
  srgbDefault: boolean;
  preferredTimingMode: boolean;
  continuousFrequency: boolean;
}

export interface Chromaticity {
  redX: number; redY: number;      // 10-bit raw values
  greenX: number; greenY: number;
  blueX: number; blueY: number;
  whiteX: number; whiteY: number;
}

export interface EstablishedTimings {
  /** Raw 3 bytes; individual modes exposed via ESTABLISHED_TIMING_TABLE. */
  byte0: number; byte1: number; byte2: number;
}

export interface StandardTiming {
  horizontalActive: number;    // pixels
  aspectRatio: 0 | 1 | 2 | 3;  // 16:10, 4:3, 5:4, 16:9
  refreshRate: number;         // Hz
}

// ------------------------------------------------------------- descriptors

export type Descriptor =
  | DetailedTimingDescriptor
  | ProductNameDescriptor
  | SerialNumberDescriptor
  | UnspecifiedTextDescriptor
  | RangeLimitsDescriptor
  | UnknownDescriptor;

export interface DetailedTimingDescriptor {
  kind: "detailed-timing";
  pixelClockKhz: number;       // stored as 10 kHz units, exposed as kHz
  hActive: number; hBlank: number;
  vActive: number; vBlank: number;
  hSyncOffset: number; hSyncPulse: number;
  vSyncOffset: number; vSyncPulse: number;
  hSizeMm: number; vSizeMm: number;
  hBorder: number; vBorder: number;
  interlaced: boolean;
  stereo: number;
  syncType: number;
  syncFlags: number;
}

/**
 * `padByte` is what follows the 0x0A terminator. VESA specifies 0x20, but real
 * panels ship 0x00, so the source value is preserved to keep saves byte-exact.
 */
export interface ProductNameDescriptor { kind: "product-name"; text: string; padByte: number; }
export interface SerialNumberDescriptor { kind: "serial-number"; text: string; padByte: number; }
export interface UnspecifiedTextDescriptor { kind: "text"; text: string; padByte: number; }

export interface RangeLimitsDescriptor {
  kind: "range-limits";
  minVerticalHz: number; maxVerticalHz: number;
  minHorizontalKhz: number; maxHorizontalKhz: number;
  maxPixelClockMhz: number;
  offsetFlags: number;
  timingSupport: number;
  /** Bytes 10..17, kept raw (CVT / secondary GTF payload). */
  extra: Uint8Array;
}

/** Any descriptor slot we do not model (incl. dummy 0x10 and unused 0x00). */
export interface UnknownDescriptor { kind: "unknown"; tag: number | null; raw: Uint8Array; }

// -------------------------------------------------------------- extensions

export type ExtensionBlock = CtaExtension | DisplayIdExtension | RawExtension;

export interface RawExtension { kind: "raw"; tag: number; raw: Uint8Array; }

export interface CtaExtension {
  kind: "cta";
  revision: number;
  underscanSupported: boolean;
  basicAudioSupported: boolean;
  ycbcr444Supported: boolean;
  ycbcr422Supported: boolean;
  nativeDtdCount: number;
  /** Byte 2 as found in the source block. Re-derived on encode whenever the
   *  block actually carries data blocks or DTDs; preserved verbatim otherwise,
   *  because 0 and 4 are both valid ways to say "nothing here". */
  sourceDtdOffset: number;
  dataBlocks: CtaDataBlock[];
  detailedTimings: DetailedTimingDescriptor[];
  /** Padding after the DTDs, preserved verbatim. */
  padding: Uint8Array;
}

export interface DisplayIdExtension {
  kind: "displayid";
  version: number;
  revision: number;
  productType: number;
  extensionCount: number;
  /**
   * Byte 2 as found in the source block. Sections routinely declare more bytes
   * than their data blocks occupy and zero-pad the remainder, so re-deriving
   * this from the walked length would shrink the section and move its checksum.
   * Preserved whenever the data blocks still fit inside it.
   */
  sourceSectionSize: number;
  dataBlocks: DisplayIdDataBlock[];
  /** Bytes from the end of the last data block to the DisplayID checksum. */
  padding: Uint8Array;
  sectionChecksum: number;
}

export interface DisplayIdDataBlock {
  tag: number;
  revision: number;
  payload: Uint8Array;
}

// -------------------------------------------------------- CTA data blocks

export type CtaDataBlock =
  | VideoDataBlock
  | AudioDataBlock
  | SpeakerAllocationBlock
  | VendorSpecificBlock
  | ExtendedTagBlock
  | UnknownCtaBlock;

export interface VideoDataBlock { kind: "video"; svds: ShortVideoDescriptor[]; }
export interface ShortVideoDescriptor { vic: number; native: boolean; }

export interface AudioDataBlock { kind: "audio"; sads: ShortAudioDescriptor[]; }
export interface ShortAudioDescriptor {
  format: number;
  maxChannels: number;
  sampleRates: number;   // bit field
  /** Meaning depends on format: bit-depth mask, max bitrate, or codec-specific. */
  byte3: number;
}

export interface SpeakerAllocationBlock { kind: "speaker-allocation"; allocation: number; raw: Uint8Array; }

export interface VendorSpecificBlock {
  kind: "vendor-specific";
  oui: number;           // 24-bit, IEEE OUI in EDID byte order
  payload: Uint8Array;   // bytes after the OUI
}

export interface ExtendedTagBlock { kind: "extended"; extendedTag: number; payload: Uint8Array; }

export interface UnknownCtaBlock { kind: "unknown-cta"; tag: number; payload: Uint8Array; }
