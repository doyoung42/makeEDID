import type { CtaDataBlock, VendorSpecificBlock, ExtendedTagBlock } from "../types.js";
import { CtaExtendedTag } from "../cta.js";
import { HDMI_14B_OUI, parseHdmi14bVsdb, buildHdmi14bVsdb, type Hdmi14bVsdb } from "./hdmi14b.js";
import { HDMI_FORUM_OUI, parseHdmiForumVsdb, buildHdmiForumVsdb, type HdmiForumVsdb } from "./hdmiForum.js";
import { HDR10PLUS_OUI, parseHdr10PlusVsvdb, buildHdr10PlusVsvdb, type Hdr10PlusVsvdb } from "./hdr10plus.js";
import { DOLBY_VISION_OUI, parseDolbyVisionVsvdb, buildDolbyVisionVsvdb, type DolbyVisionVsvdb } from "./dolbyVision.js";
import { AMD_FREESYNC_OUI, parseAmdFreesyncVsdb, buildAmdFreesyncVsdb, type AmdFreesyncVsdb } from "./amdFreesync.js";

export * from "./hdmi14b.js";
export * from "./hdmiForum.js";
export * from "./hdr10plus.js";
export * from "./dolbyVision.js";
export * from "./amdFreesync.js";

/** Known OUIs, for labelling blocks we do not decode structurally. */
export const OUI_NAMES: Record<number, string> = {
  [HDMI_14B_OUI]: "HDMI Licensing LLC (HDMI 1.4b)",
  [HDMI_FORUM_OUI]: "HDMI Forum (HDMI 2.1)",
  [DOLBY_VISION_OUI]: "Dolby Laboratories (Dolby Vision)",
  [HDR10PLUS_OUI]: "HDR10+ Technologies",
  [AMD_FREESYNC_OUI]: "AMD (FreeSync)",
};

export type VsdbView =
  | { oui: typeof HDMI_14B_OUI; type: "hdmi14b"; data: Hdmi14bVsdb }
  | { oui: typeof HDMI_FORUM_OUI; type: "hdmi-forum"; data: HdmiForumVsdb }
  | { oui: typeof DOLBY_VISION_OUI; type: "dolby-vision"; data: DolbyVisionVsvdb }
  | { oui: typeof HDR10PLUS_OUI; type: "hdr10plus"; data: Hdr10PlusVsvdb }
  | { oui: typeof AMD_FREESYNC_OUI; type: "amd-freesync"; data: AmdFreesyncVsdb }
  | { oui: number; type: "generic"; data: { payload: Uint8Array } };

/** A CTA block that carries an OUI, whether plain or extended-tag wrapped. */
export interface VendorBlockRef {
  oui: number;
  payload: Uint8Array;
  /** How the OUI is carried, so the block can be rebuilt in the same shape. */
  carrier: "vendor-specific" | "vendor-specific-video" | "vendor-specific-audio";
}

export function asVendorBlock(block: CtaDataBlock): VendorBlockRef | null {
  if (block.kind === "vendor-specific") {
    return { oui: block.oui, payload: block.payload, carrier: "vendor-specific" };
  }
  if (block.kind === "extended") {
    const carrier =
      block.extendedTag === CtaExtendedTag.VendorSpecificVideo ? "vendor-specific-video" :
      block.extendedTag === CtaExtendedTag.VendorSpecificAudio ? "vendor-specific-audio" : null;
    if (!carrier || block.payload.length < 3) return null;
    const oui = (block.payload[2]! << 16) | (block.payload[1]! << 8) | block.payload[0]!;
    return { oui, payload: Uint8Array.from(block.payload.subarray(3)), carrier };
  }
  return null;
}

/** Decode a vendor block's payload into a structured, editable view. */
export function parseVsdb(ref: VendorBlockRef): VsdbView {
  switch (ref.oui) {
    case HDMI_14B_OUI:    return { oui: HDMI_14B_OUI, type: "hdmi14b", data: parseHdmi14bVsdb(ref.payload) };
    case HDMI_FORUM_OUI:  return { oui: HDMI_FORUM_OUI, type: "hdmi-forum", data: parseHdmiForumVsdb(ref.payload) };
    case DOLBY_VISION_OUI: return { oui: DOLBY_VISION_OUI, type: "dolby-vision", data: parseDolbyVisionVsvdb(ref.payload) };
    case HDR10PLUS_OUI:   return { oui: HDR10PLUS_OUI, type: "hdr10plus", data: parseHdr10PlusVsvdb(ref.payload) };
    case AMD_FREESYNC_OUI: return { oui: AMD_FREESYNC_OUI, type: "amd-freesync", data: parseAmdFreesyncVsdb(ref.payload) };
    default:              return { oui: ref.oui, type: "generic", data: { payload: Uint8Array.from(ref.payload) } };
  }
}

/** Re-emit a structured view as payload bytes (the hex the old tool made you type). */
export function buildVsdb(view: VsdbView): Uint8Array {
  switch (view.type) {
    case "hdmi14b":      return buildHdmi14bVsdb(view.data);
    case "hdmi-forum":   return buildHdmiForumVsdb(view.data);
    case "dolby-vision": return buildDolbyVisionVsvdb(view.data);
    case "hdr10plus":    return buildHdr10PlusVsvdb(view.data);
    case "amd-freesync": return buildAmdFreesyncVsdb(view.data);
    case "generic":      return Uint8Array.from(view.data.payload);
  }
}

/** Rebuild a CTA data block from a vendor ref, preserving how the OUI was carried. */
export function toCtaBlock(ref: VendorBlockRef, payload: Uint8Array): VendorSpecificBlock | ExtendedTagBlock {
  const ouiBytes = [ref.oui & 0xff, (ref.oui >> 8) & 0xff, (ref.oui >> 16) & 0xff];
  if (ref.carrier === "vendor-specific") {
    return { kind: "vendor-specific", oui: ref.oui, payload: Uint8Array.from(payload) };
  }
  return {
    kind: "extended",
    extendedTag: ref.carrier === "vendor-specific-video"
      ? CtaExtendedTag.VendorSpecificVideo
      : CtaExtendedTag.VendorSpecificAudio,
    payload: Uint8Array.from([...ouiBytes, ...payload]),
  };
}

export function ouiToString(oui: number): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `${hex((oui >> 16) & 0xff)}-${hex((oui >> 8) & 0xff)}-${hex(oui & 0xff)}`;
}
