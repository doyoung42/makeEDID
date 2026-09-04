import { bit } from "../bytes.js";

/**
 * AMD FreeSync VSDB, OUI 00-00-1A.
 *
 * Layout ported from decoders.decode_amd_vsdb in the reference Python platform:
 *   [0] version
 *   [1] flags — FreeSync(0), native(1), local dimming disable(3)
 *   [2] min refresh rate (Hz)
 *   [3] max refresh rate (Hz)
 *   [4] MCCS VCP code support
 *   [5] gamma bits
 *   [6] max luminance 1      [7] min luminance 1 (raw)
 *   [8] max luminance 2      [9] min luminance 2 (raw)
 *   [10..11] Max LSB FreeSync refresh rate (LE) — named by the DDC Manager
 *            oracle, which reports 0x01F4 here as "500"
 *
 * ATP Manager reports this block only as "Unknown Vendor specific data Block",
 * so decoding it is a straight improvement over the tool being replaced.
 */
export const AMD_FREESYNC_OUI = 0x00001a;

export interface AmdFreesyncVsdb {
  version: number;
  flagsRaw: number;
  freesyncSupported: boolean;
  native: boolean;
  localDimmingDisable: boolean;
  minRefreshHz: number;
  maxRefreshHz: number;
  mccsVcpSupport: number;
  gammaBits: number;
  maxLuminance1: number;
  minLuminance1Raw: number;
  maxLuminance2: number;
  minLuminance2Raw: number;
  maxLsbFreesyncRefreshHz: number;
  /** Number of bytes actually present, so a short block rebuilds unchanged. */
  presentBytes: number;
  trailing: Uint8Array;
}

const MODELLED = 12;

export function parseAmdFreesyncVsdb(p: Uint8Array): AmdFreesyncVsdb {
  if (p.length < 1) throw new Error("AMD FreeSync payload is empty");
  const at = (i: number) => (i < p.length ? p[i]! : 0);
  const flags = at(1);
  return {
    version: at(0),
    flagsRaw: flags,
    freesyncSupported: bit(flags, 0),
    native: bit(flags, 1),
    localDimmingDisable: bit(flags, 3),
    minRefreshHz: at(2),
    maxRefreshHz: at(3),
    mccsVcpSupport: at(4),
    gammaBits: at(5),
    maxLuminance1: at(6),
    minLuminance1Raw: at(7),
    maxLuminance2: at(8),
    minLuminance2Raw: at(9),
    maxLsbFreesyncRefreshHz: at(10) | (at(11) << 8),
    presentBytes: Math.min(p.length, MODELLED),
    trailing: Uint8Array.from(p.subarray(MODELLED)),
  };
}

export function buildAmdFreesyncVsdb(v: AmdFreesyncVsdb): Uint8Array {
  const all = [
    v.version, v.flagsRaw, v.minRefreshHz, v.maxRefreshHz, v.mccsVcpSupport,
    v.gammaBits, v.maxLuminance1, v.minLuminance1Raw, v.maxLuminance2, v.minLuminance2Raw,
    v.maxLsbFreesyncRefreshHz & 0xff, (v.maxLsbFreesyncRefreshHz >> 8) & 0xff,
  ].map((x) => x & 0xff);
  return Uint8Array.from([...all.slice(0, v.presentBytes), ...v.trailing]);
}

/** Minimum luminance is stored as a square-root-companded code, not cd/m². */
export function amdMinLuminance(raw: number, max: number): number {
  if (max === 0) return 0;
  return ((raw / 255) ** 2 * max) / 100;
}
