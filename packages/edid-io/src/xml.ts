import { hexToBytes, bytesToHex, splitBlocks, BLOCK_SIZE, MAX_BLOCKS } from "@edid/core";

/**
 * Reader/writer for the ATP Manager (980mgr) DATAOBJ EDID format.
 *
 * Mirrors com.quantumdata.i980.core.edid.EdidDataFile: BLOCK0..BLOCK31 each hold
 * uppercase hex for one 128-byte block, and reading stops at the first missing
 * or empty BLOCKn element.
 */

const XML_TYPE = "DID";

export function parseEdidXml(xml: string): Uint8Array {
  if (!xml.includes("<DATAOBJ")) throw new Error("not a DATAOBJ file");

  const blocks: Uint8Array[] = [];
  for (let n = 0; n < MAX_BLOCKS; n++) {
    const text = extractElementText(xml, "BLOCK" + n);
    if (text === null || text.trim() === "") break;   // reader stops at the first empty block
    const bytes = hexToBytes(text.trim());
    if (bytes.length !== BLOCK_SIZE) {
      throw new Error("BLOCK" + n + " is " + bytes.length + " bytes; expected " + BLOCK_SIZE);
    }
    blocks.push(bytes);
  }

  if (blocks.length === 0) throw new Error("no EDID blocks found");
  const out = new Uint8Array(blocks.length * BLOCK_SIZE);
  blocks.forEach((b, i) => out.set(b, i * BLOCK_SIZE));
  return out;
}

/**
 * Returns the text of `<TAG>...</TAG>`, "" for the self-closing `<TAG/>` form,
 * or null when the element is absent. Plain string search rather than a regex:
 * the closing ">" makes "<BLOCK1>" an exact match that cannot hit "<BLOCK10>".
 */
function extractElementText(xml: string, tag: string): string | null {
  const open = "<" + tag + ">";
  const start = xml.indexOf(open);
  if (start !== -1) {
    const close = "</" + tag + ">";
    const end = xml.indexOf(close, start + open.length);
    if (end === -1) throw new Error("unclosed <" + tag + "> element");
    return xml.slice(start + open.length, end);
  }
  return xml.includes("<" + tag + "/>") || xml.includes("<" + tag + " />") ? "" : null;
}

export function serialiseEdidXml(data: Uint8Array): string {
  const blocks = splitBlocks(data);
  const lines = blocks.map((b, i) => "        <BLOCK" + i + ">" + bytesToHex(b) + "</BLOCK" + i + ">");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    "<DATAOBJ>",
    '    <HEADER TYPE="' + XML_TYPE + '" VERSION="1.0"/>',
    "    <DATA>",
    ...lines,
    "    </DATA>",
    "</DATAOBJ>",
  ].join("\n");
}
