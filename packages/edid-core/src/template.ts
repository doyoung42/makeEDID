import type { Edid, BaseBlock, DetailedTimingDescriptor } from "./types.js";

/**
 * Templates for creating an EDID from scratch.
 *
 * Everything else in this package reads an existing EDID; a new file has to
 * start somewhere, and starting from 128 zero bytes fails at the header check.
 * The values here are deliberately generic placeholders — a real model's
 * identity is the first thing an engineer edits.
 */

export interface BlankEdidOptions {
  /** 3-letter PnP manufacturer ID. */
  manufacturerId?: string;
  productCode?: number;
  productName?: string;
  /** Absolute year, e.g. 2026. */
  year?: number;
  /** Preferred timing, used for descriptor 1 and the physical size. */
  timing?: BlankTiming;
}

export interface BlankTiming {
  hActive: number;
  vActive: number;
  refreshHz: number;
  pixelClockKhz: number;
  hBlank: number;
  vBlank: number;
  hSyncOffset: number;
  hSyncPulse: number;
  vSyncOffset: number;
  vSyncPulse: number;
  hSizeMm: number;
  vSizeMm: number;
}

/** 1920x1080p60, CVT-ish blanking — a safe, universally understood default. */
export const DEFAULT_TIMING: BlankTiming = {
  hActive: 1920, vActive: 1080, refreshHz: 60, pixelClockKhz: 148500,
  hBlank: 280, vBlank: 45,
  hSyncOffset: 88, hSyncPulse: 44,
  vSyncOffset: 4, vSyncPulse: 5,
  hSizeMm: 598, vSizeMm: 336,
};

/**
 * A minimal EDID 1.4 base block with no extensions.
 *
 * Checksums are not set here — `encodeEdid` recomputes them on the way out,
 * which is the single place this project allows a value to be re-derived.
 */
export function createBlankEdid(options: BlankEdidOptions = {}): Edid {
  const t = options.timing ?? DEFAULT_TIMING;
  const name = (options.productName ?? "NEW MONITOR").slice(0, 13);

  const dtd: DetailedTimingDescriptor = {
    kind: "detailed-timing",
    pixelClockKhz: t.pixelClockKhz,
    hActive: t.hActive, hBlank: t.hBlank,
    vActive: t.vActive, vBlank: t.vBlank,
    hSyncOffset: t.hSyncOffset, hSyncPulse: t.hSyncPulse,
    vSyncOffset: t.vSyncOffset, vSyncPulse: t.vSyncPulse,
    hSizeMm: t.hSizeMm, vSizeMm: t.vSizeMm,
    hBorder: 0, vBorder: 0,
    interlaced: false,
    stereo: 0,
    syncType: 3,      // digital separate
    syncFlags: 3,     // vsync+, hsync+
  };

  const base: BaseBlock = {
    manufacturerId: (options.manufacturerId ?? "SAM").toUpperCase().slice(0, 3),
    productCode: options.productCode ?? 0,
    serialNumber: 0,
    manufactureWeek: 1,
    manufactureYear: options.year ?? new Date().getFullYear(),
    modelYearFlag: false,
    edidVersion: 1,
    edidRevision: 4,
    videoInput: { kind: "digital", bitDepth: 8, videoInterface: 5 }, // 8 bpc, DisplayPort
    horizontalSizeCm: Math.round(t.hSizeMm / 10),
    verticalSizeCm: Math.round(t.vSizeMm / 10),
    gammaRaw: 120,   // gamma 2.20
    features: {
      standbySupported: false,
      suspendSupported: false,
      activeOffSupported: true,
      colorType: 0,
      srgbDefault: false,
      preferredTimingMode: true,
      continuousFrequency: false,
    },
    // sRGB-ish primaries in the 10-bit raw encoding the base block uses.
    chromaticity: {
      redX: 660, redY: 340,
      greenX: 307, greenY: 614,
      blueX: 154, blueY: 61,
      whiteX: 320, whiteY: 337,
    },
    establishedTimings: { byte0: 0, byte1: 0, byte2: 0 },
    standardTimings: [null, null, null, null, null, null, null, null],
    descriptors: [
      dtd,
      {
        kind: "range-limits",
        minVerticalHz: 48, maxVerticalHz: Math.max(t.refreshHz, 60),
        minHorizontalKhz: 30, maxHorizontalKhz: 160,
        maxPixelClockMhz: Math.ceil(t.pixelClockKhz / 1000 / 10) * 10,
        offsetFlags: 0,
        timingSupport: 0,
        extra: Uint8Array.from([0x0a, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]),
      },
      { kind: "product-name", text: name, padByte: 0x20 },
      { kind: "unknown", tag: 0x10, raw: new Uint8Array(18) },
    ],
    extensionCount: 0,
  };

  return { base, extensions: [] };
}
