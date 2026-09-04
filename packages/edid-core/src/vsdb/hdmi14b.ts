import { bits, bit, packBits } from "../bytes.js";

/**
 * HDMI 1.4b VSDB, OUI 00-0C-03.
 *
 * Layout follows com.quantumdata.i980.core.edid.model.cea.dblock.hdmi.Hdmi14bVsdb:
 *   [0..1] Source Physical Address (A.B.C.D)
 *   [2]    Supports_AI(7) DC_48bit(6) DC_36bit(5) DC_30bit(4) DC_Y444(3) DVI_Dual(0)
 *   [3]    Max_TMDS_Clock (5 MHz units)
 *   [4]    Latency_Fields_Present(7) I_Latency_Fields_Present(6) HDMI_Video_present(5)
 *          Game(3) Cinema(2) Photo(1) Graphics(0)
 *   then   video/audio latency pairs (2 bytes each, gated by the flags above),
 *   then   the HDMI-video section when HDMI_Video_present is set.
 *
 * Every trailing region we cannot model is carried verbatim so that a save of
 * an untouched block is byte-identical.
 */
export const HDMI_14B_OUI = 0x000c03;

export interface Hdmi14bVsdb {
  physicalAddress: [number, number, number, number];
  supportsAi: boolean;
  dc48bit: boolean;
  dc36bit: boolean;
  dc30bit: boolean;
  dcY444: boolean;
  dviDualLink: boolean;
  maxTmdsClockMhz: number;
  /** Null when the block stops after the physical address. */
  flags: Hdmi14bFlags | null;
  latency: { video: number; audio: number } | null;
  interlacedLatency: { video: number; audio: number } | null;
  /** Present when HDMI_Video_present is set and the section parsed cleanly. */
  video: Hdmi14bVideo | null;
  /**
   * How many of the five head bytes (physical address, flags1, Max_TMDS,
   * flags2) the source actually carried. Blocks stop early — some are three
   * bytes total — so this must not be re-derived from which fields are set.
   */
  headBytes: number;
  /** Bytes past everything modelled above, preserved verbatim. */
  trailing: Uint8Array;
}

export interface Hdmi14bFlags {
  latencyFieldsPresent: boolean;
  interlacedLatencyFieldsPresent: boolean;
  hdmiVideoPresent: boolean;
  supportsGame: boolean;
  supportsCinema: boolean;
  supportsPhoto: boolean;
  supportsGraphics: boolean;
}

export interface Hdmi14bVideo {
  /**
   * False when the block ends right after the flags byte. 102 EDIDs in the
   * corpus set HDMI_Video_present but omit the length byte that should follow,
   * so the flags are still readable while the section stays one byte long.
   */
  hasLengthByte: boolean;
  /** Whole flags byte: 3D_present(7), 3D_Multi_present(6:5), Image_Size(4:3), reserved(2:0). */
  flagsRaw: number;
  threeDPresent: boolean;
  threeDMultiPresent: number;
  imageSize: number;
  /** 4K x 2K modes, as HDMI VIC codes (not CTA VICs). */
  hdmiVics: number[];
  /** 16-bit big-endian masks, present per 3D_Multi_present. */
  structure3D: number | null;
  mask3D: number | null;
  entries3D: Entry3D[];
  /** Remainder of the declared 3D length we did not consume. */
  extra3D: Uint8Array;
}

export interface Entry3D {
  /** Index into the SVD list, not a VIC. */
  vicIndex: number;
  structure: number;
  /** Only present for structures 8..15 (side-by-side half). */
  detail: number | null;
}

/** 3D_Structure values 8..15 carry an extra byte holding 3D_Detail. */
export function entry3DByteLength(structure: number): number {
  return structure >= 8 ? 2 : 1;
}

export const THREE_D_STRUCTURES: Record<number, string> = {
  0: "Frame packing", 1: "Field alternative", 2: "Line alternative",
  3: "Side-by-side (full)", 4: "L + depth", 5: "L + depth + graphics",
  6: "Top-and-bottom", 8: "Side-by-side (half)",
};

export function parseHdmi14bVsdb(p: Uint8Array): Hdmi14bVsdb {
  if (p.length < 2) throw new Error(`HDMI VSDB payload is ${p.length} bytes; at least 2 required`);

  const b0 = p[0]!, b1 = p[1]!;
  const v: Hdmi14bVsdb = {
    physicalAddress: [bits(b0, 7, 4), bits(b0, 3, 0), bits(b1, 7, 4), bits(b1, 3, 0)],
    supportsAi: false, dc48bit: false, dc36bit: false, dc30bit: false,
    dcY444: false, dviDualLink: false,
    maxTmdsClockMhz: 0,
    flags: null, latency: null, interlacedLatency: null, video: null,
    headBytes: Math.min(p.length, 5),
    trailing: new Uint8Array(0),
  };

  if (p.length >= 3) {
    const f1 = p[2]!;
    v.supportsAi = bit(f1, 7);
    v.dc48bit = bit(f1, 6);
    v.dc36bit = bit(f1, 5);
    v.dc30bit = bit(f1, 4);
    v.dcY444 = bit(f1, 3);
    v.dviDualLink = bit(f1, 0);
  }
  if (p.length >= 4) v.maxTmdsClockMhz = p[3]! * 5;

  let i = 4;
  if (p.length >= 5) {
    const f2 = p[4]!;
    v.flags = {
      latencyFieldsPresent: bit(f2, 7),
      interlacedLatencyFieldsPresent: bit(f2, 6),
      hdmiVideoPresent: bit(f2, 5),
      supportsGame: bit(f2, 3),
      supportsCinema: bit(f2, 2),
      supportsPhoto: bit(f2, 1),
      supportsGraphics: bit(f2, 0),
    };
    i = 5;

    if (v.flags.latencyFieldsPresent && i + 1 < p.length) {
      v.latency = { video: p[i]!, audio: p[i + 1]! };
      i += 2;
      if (v.flags.interlacedLatencyFieldsPresent && i + 1 < p.length) {
        v.interlacedLatency = { video: p[i]!, audio: p[i + 1]! };
        i += 2;
      }
    }

    if (v.flags.hdmiVideoPresent && i < p.length) {
      const parsed = parseVideoSection(p.subarray(i));
      if (parsed) {
        v.video = parsed.video;
        i += parsed.consumed;
      }
    }
  }

  v.trailing = Uint8Array.from(p.subarray(i));
  return v;
}

function parseVideoSection(s: Uint8Array): { video: Hdmi14bVideo; consumed: number } | null {
  if (s.length < 1) return null;

  const flagsRaw = s[0]!;
  if (s.length < 2) {
    return {
      video: {
        hasLengthByte: false, flagsRaw,
        threeDPresent: bit(flagsRaw, 7),
        threeDMultiPresent: bits(flagsRaw, 6, 5),
        imageSize: bits(flagsRaw, 4, 3),
        hdmiVics: [], structure3D: null, mask3D: null,
        entries3D: [], extra3D: new Uint8Array(0),
      },
      consumed: 1,
    };
  }

  const lenByte = s[1]!;
  const vicLen = bits(lenByte, 7, 5);
  const threeDLen = bits(lenByte, 4, 0);

  let at = 2;
  if (at + vicLen > s.length) return null;
  const hdmiVics = Array.from(s.subarray(at, at + vicLen));
  at += vicLen;

  const video: Hdmi14bVideo = {
    hasLengthByte: true,
    flagsRaw,
    threeDPresent: bit(flagsRaw, 7),
    threeDMultiPresent: bits(flagsRaw, 6, 5),
    imageSize: bits(flagsRaw, 4, 3),
    hdmiVics,
    structure3D: null,
    mask3D: null,
    entries3D: [],
    extra3D: new Uint8Array(0),
  };

  const threeDStart = at;
  if (at + threeDLen > s.length) return null;

  if (video.threeDPresent) {
    let remaining = threeDLen;
    // 3D_Multi_present: 1 = structure mask only, 2 = structure + mask.
    if (video.threeDMultiPresent === 1 || video.threeDMultiPresent === 2) {
      if (remaining < 2) return null;
      video.structure3D = (s[at]! << 8) | s[at + 1]!;
      at += 2; remaining -= 2;
    }
    if (video.threeDMultiPresent === 2) {
      if (remaining < 2) return null;
      video.mask3D = (s[at]! << 8) | s[at + 1]!;
      at += 2; remaining -= 2;
    }
    while (remaining > 0) {
      const head = s[at]!;
      const structure = head & 0x0f;
      const width = entry3DByteLength(structure);
      if (remaining < width) break;
      const entry: Entry3D = { vicIndex: (head >> 4) & 0x0f, structure, detail: null };
      if (width > 1) entry.detail = (s[at + 1]! >> 4) & 0x0f;
      video.entries3D.push(entry);
      at += width; remaining -= width;
    }
    video.extra3D = Uint8Array.from(s.subarray(at, threeDStart + threeDLen));
    at = threeDStart + threeDLen;
  }

  return { video, consumed: at };
}

export function buildHdmi14bVsdb(v: Hdmi14bVsdb): Uint8Array {
  const [a, b, c, d] = v.physicalAddress;
  const out: number[] = [((a & 0xf) << 4) | (b & 0xf), ((c & 0xf) << 4) | (d & 0xf)];

  if (v.headBytes > 2) {
    out.push(packBits([7, 7, +v.supportsAi], [6, 6, +v.dc48bit], [5, 5, +v.dc36bit],
                      [4, 4, +v.dc30bit], [3, 3, +v.dcY444], [0, 0, +v.dviDualLink]));
  }
  if (v.headBytes > 3) out.push(Math.ceil(v.maxTmdsClockMhz / 5) & 0xff);

  if (v.flags) {
    const f = v.flags;
    out.push(packBits([7, 7, +f.latencyFieldsPresent], [6, 6, +f.interlacedLatencyFieldsPresent],
                      [5, 5, +f.hdmiVideoPresent], [3, 3, +f.supportsGame], [2, 2, +f.supportsCinema],
                      [1, 1, +f.supportsPhoto], [0, 0, +f.supportsGraphics]));
    if (v.latency) {
      out.push(v.latency.video & 0xff, v.latency.audio & 0xff);
      if (v.interlacedLatency) {
        out.push(v.interlacedLatency.video & 0xff, v.interlacedLatency.audio & 0xff);
      }
    }
    if (v.video) out.push(...buildVideoSection(v.video));
  }

  out.push(...v.trailing);
  return Uint8Array.from(out);
}

function buildVideoSection(video: Hdmi14bVideo): number[] {
  if (!video.hasLengthByte) return [video.flagsRaw & 0xff];

  const threeD: number[] = [];
  if (video.threeDPresent) {
    if (video.structure3D !== null) threeD.push((video.structure3D >> 8) & 0xff, video.structure3D & 0xff);
    if (video.mask3D !== null) threeD.push((video.mask3D >> 8) & 0xff, video.mask3D & 0xff);
    for (const e of video.entries3D) {
      threeD.push(((e.vicIndex & 0x0f) << 4) | (e.structure & 0x0f));
      if (entry3DByteLength(e.structure) > 1) threeD.push(((e.detail ?? 0) & 0x0f) << 4);
    }
    threeD.push(...video.extra3D);
  }

  if (video.hdmiVics.length > 7) throw new Error("HDMI_VIC list holds at most 7 entries");
  if (threeD.length > 31) throw new Error("HDMI 3D section exceeds the 5-bit length field");

  return [
    video.flagsRaw & 0xff,
    ((video.hdmiVics.length & 0x07) << 5) | (threeD.length & 0x1f),
    ...video.hdmiVics.map((x) => x & 0xff),
    ...threeD,
  ];
}

export function formatPhysicalAddress(addr: [number, number, number, number]): string {
  return addr.join(".");
}
