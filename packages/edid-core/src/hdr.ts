/**
 * CTA-861 HDR Static Metadata Data Block — luminance code ↔ cd/m² conversion.
 *
 * The formula is not in any registered spec extract (extractions carry offsets
 * but no calculations — see `packages/edid-core/CLAUDE.md`). It comes from the
 * decompiled `HdrStaticMetadataBlock.luminance(Lum)`
 * (`reference/decompiled/.../cea/dblock/hdr/HdrStaticMetadataBlock.java`),
 * the strongest evidence tier this project uses:
 *
 *   Max / Avg luminance (cd/m²) = 50 * 2^(CV/32)
 *   Min luminance (cd/m²)       = MaxLuminance * (CV/255)^2 / 100
 *
 * The encode side (cd/m² -> code) is the algebraic inverse of that confirmed
 * formula, not a separate guess.
 */

const LUM_CODE_MIN = 0;
const LUM_CODE_MAX = 255;

function clampCode(n: number): number {
  return Math.min(LUM_CODE_MAX, Math.max(LUM_CODE_MIN, Math.round(n)));
}

/** Max or Max Frame-Average luminance: 50 * 2^(CV/32). */
export function hdrMaxAvgLuminanceCdm2(code: number): number {
  return 50 * Math.pow(2, code / 32);
}

/** Inverse of `hdrMaxAvgLuminanceCdm2`: CV = 32 * log2(cdm2 / 50). */
export function hdrMaxAvgLuminanceCode(cdm2: number): number {
  if (!(cdm2 > 0)) throw new Error("Luminance must be a positive number of cd/m²");
  return clampCode(32 * Math.log2(cdm2 / 50));
}

/** Min luminance: MaxLuminance * (CV/255)^2 / 100. Needs the block's own max code. */
export function hdrMinLuminanceCdm2(minCode: number, maxCode: number): number {
  const maxCdm2 = hdrMaxAvgLuminanceCdm2(maxCode);
  return maxCdm2 * Math.pow(minCode / 255, 2) / 100;
}

/**
 * Inverse of `hdrMinLuminanceCdm2`: CV = 255 * sqrt(cdm2 * 100 / MaxLuminance).
 * Needs the sibling max code to know what MaxLuminance is. `50 * 2^(code/32)`
 * is positive for every representable code, so there is no "unset" max to guard.
 */
export function hdrMinLuminanceCode(cdm2: number, maxCode: number): number {
  if (cdm2 < 0) throw new Error("Luminance must not be negative");
  const maxCdm2 = hdrMaxAvgLuminanceCdm2(maxCode);
  return clampCode(255 * Math.sqrt((cdm2 * 100) / maxCdm2));
}
