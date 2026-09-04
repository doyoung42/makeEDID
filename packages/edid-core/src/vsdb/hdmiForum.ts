import { bits, bit, packBits } from "../bytes.js";

/**
 * HDMI Forum VSDB (HF-VSDB), OUI C4-5D-D8.
 *
 * Layout mirrors com.quantumdata.i980.core.edid.model.cea.dblock.hdmi.Scds:
 *   [0] version
 *   [1] Max_TMDS_Character_Rate (5 MHz units)
 *   [2] SCDC_Present(7) RR_Capable(6) CABLE_STATUS(5) CCBPCI(4)
 *       LTE_340MHz_scramble(3) Independent_View(2) Dual_View(1) 3D_OSD_Disparity(0)
 *   [3] Max_FRL_Rate(7:4) UHD_VIC(3) DC_48bit_420(2) DC_36bit_420(1) DC_30bit_420(0)
 *   [4] FAPA_End_Extended(7) QMS(6) Mdelta(5) CinemaVRR(4)
 *       NEG_MVRR(3) FVA(2) ALLM(1) FAPA_start_location(0)
 *   [5] VRR_max(9:8) in bits 7:6, VRR_min in bits 5:0
 *   [6] VRR_max(7:0)
 *   [7] DSC_1p2(7) DSC_Native_420(6) QMS_TFRmax(5) QMS_TFRmin(4)
 *       DSC_All_bpp(3) DSC_16bpc(2) DSC_12bpc(1) DSC_10bpc(0)
 *   [8] DSC_Max_FRL_Rate(7:4) DSC_Max_Slices(3:0)
 *   [9] DSC_TotalChunkKBytes(5:0)
 */
export const HDMI_FORUM_OUI = 0xc45dd8;

export interface HdmiForumVsdb {
  version: number;
  maxTmdsClockMhz: number;
  scdcPresent: boolean;
  rrCapable: boolean;
  cableStatus: boolean;
  ccbpci: boolean;
  lte340MhzScramble: boolean;
  independentView: boolean;
  dualView: boolean;
  osdDisparity3d: boolean;
  maxFrlRate: number;
  uhdVic: boolean;
  dc48bit420: boolean;
  dc36bit420: boolean;
  dc30bit420: boolean;
  ext: HdmiForumExt | null;
  vrr: { min: number; max: number } | null;
  dsc: HdmiForumDsc | null;
  /** Bytes past everything modelled above, preserved verbatim. */
  trailing: Uint8Array;
}

export interface HdmiForumExt {
  fapaStartLocation: boolean;
  allm: boolean;
  fva: boolean;
  negMvrr: boolean;
  cinemaVrr: boolean;
  mdelta: boolean;
  qms: boolean;
  fapaEndExtended: boolean;
}

export interface HdmiForumDsc {
  dsc10bpc: boolean;
  dsc12bpc: boolean;
  dsc16bpc: boolean;
  dscAllBpp: boolean;
  qmsTfrMin: boolean;
  qmsTfrMax: boolean;
  dscNative420: boolean;
  dsc1p2: boolean;
  maxSlices: number;
  maxFrlRate: number;
  totalChunkKBytes: number;
}

export function parseHdmiForumVsdb(p: Uint8Array): HdmiForumVsdb {
  if (p.length < 4) throw new Error(`HF-VSDB payload is ${p.length} bytes; at least 4 required`);

  const o0 = p[2]!;
  const o1 = p[3]!;
  const v: HdmiForumVsdb = {
    version: p[0]!,
    maxTmdsClockMhz: p[1]! * 5,
    scdcPresent: bit(o0, 7),
    rrCapable: bit(o0, 6),
    cableStatus: bit(o0, 5),
    ccbpci: bit(o0, 4),
    lte340MhzScramble: bit(o0, 3),
    independentView: bit(o0, 2),
    dualView: bit(o0, 1),
    osdDisparity3d: bit(o0, 0),
    maxFrlRate: bits(o1, 7, 4),
    uhdVic: bit(o1, 3),
    dc48bit420: bit(o1, 2),
    dc36bit420: bit(o1, 1),
    dc30bit420: bit(o1, 0),
    ext: null,
    vrr: null,
    dsc: null,
    trailing: new Uint8Array(0),
  };

  let consumed = 4;
  if (p.length > 4) {
    const o2 = p[4]!;
    v.ext = {
      fapaStartLocation: bit(o2, 0),
      allm: bit(o2, 1),
      fva: bit(o2, 2),
      negMvrr: bit(o2, 3),
      cinemaVrr: bit(o2, 4),
      mdelta: bit(o2, 5),
      qms: bit(o2, 6),
      fapaEndExtended: bit(o2, 7),
    };
    consumed = 5;
  }

  if (p.length > 5 && p.length >= 7) {
    v.vrr = { min: p[5]! & 0x3f, max: ((p[5]! & 0xc0) << 2) | p[6]! };
    consumed = 7;
  }

  if (p.length > 7 && p.length >= 10) {
    const d0 = p[7]!, d1 = p[8]!, d2 = p[9]!;
    v.dsc = {
      dsc10bpc: bit(d0, 0),
      dsc12bpc: bit(d0, 1),
      dsc16bpc: bit(d0, 2),
      dscAllBpp: bit(d0, 3),
      qmsTfrMin: bit(d0, 4),
      qmsTfrMax: bit(d0, 5),
      dscNative420: bit(d0, 6),
      dsc1p2: bit(d0, 7),
      maxSlices: bits(d1, 3, 0),
      maxFrlRate: bits(d1, 7, 4),
      totalChunkKBytes: bits(d2, 5, 0),
    };
    consumed = 10;
  }

  v.trailing = Uint8Array.from(p.subarray(consumed));
  return v;
}

export function buildHdmiForumVsdb(v: HdmiForumVsdb): Uint8Array {
  const out: number[] = [
    v.version & 0xff,
    Math.ceil(v.maxTmdsClockMhz / 5) & 0xff,
    packBits([7, 7, +v.scdcPresent], [6, 6, +v.rrCapable], [5, 5, +v.cableStatus], [4, 4, +v.ccbpci],
             [3, 3, +v.lte340MhzScramble], [2, 2, +v.independentView], [1, 1, +v.dualView], [0, 0, +v.osdDisparity3d]),
    packBits([7, 4, v.maxFrlRate], [3, 3, +v.uhdVic], [2, 2, +v.dc48bit420], [1, 1, +v.dc36bit420], [0, 0, +v.dc30bit420]),
  ];

  if (v.ext) {
    const e = v.ext;
    out.push(packBits([7, 7, +e.fapaEndExtended], [6, 6, +e.qms], [5, 5, +e.mdelta], [4, 4, +e.cinemaVrr],
                      [3, 3, +e.negMvrr], [2, 2, +e.fva], [1, 1, +e.allm], [0, 0, +e.fapaStartLocation]));
  }

  if (v.vrr) {
    out.push(((v.vrr.max >> 2) & 0xc0) | (v.vrr.min & 0x3f));
    out.push(v.vrr.max & 0xff);
  }

  if (v.dsc) {
    const d = v.dsc;
    out.push(packBits([7, 7, +d.dsc1p2], [6, 6, +d.dscNative420], [5, 5, +d.qmsTfrMax], [4, 4, +d.qmsTfrMin],
                      [3, 3, +d.dscAllBpp], [2, 2, +d.dsc16bpc], [1, 1, +d.dsc12bpc], [0, 0, +d.dsc10bpc]));
    out.push(packBits([7, 4, d.maxFrlRate], [3, 0, d.maxSlices]));
    out.push(d.totalChunkKBytes & 0x3f);
  }

  out.push(...v.trailing);
  return Uint8Array.from(out);
}

/** Max_FRL_Rate / DSC_Max_FRL_Rate code -> human label (HDMI 2.1 Table 7-34). */
export const MAX_FRL_RATE_LABELS = [
  "Not supported", "3 Gbps x3 lanes", "6 Gbps x3 lanes", "6 Gbps x4 lanes",
  "8 Gbps x4 lanes", "10 Gbps x4 lanes", "12 Gbps x4 lanes",
] as const;
