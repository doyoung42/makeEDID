import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeEdid, encodeEdid, flattenEdid, splitBlocks, isChecksumValid, bytesEqual, bytesToHex,
  halfToFloat, floatToHalf, readColorCoord12, writeColorCoord12, coordToCie,
  parseDisplayParamsV2, buildDisplayParamsV2, DISPLAY_PARAMS_V2_LENGTH,
  parseAdaptiveSync, buildAdaptiveSync, singleFrameDeltaPercent,
  parseTiledTopology, buildTiledTopology, TILED_TOPOLOGY_LENGTH,
  formatContainerId, didTagLabel, isV2Tag, DidTag,
} from "../packages/edid-core/dist/index.js";
import { parseEdidXml } from "../packages/edid-io/dist/index.js";
import { SAMPLES_DIR, skipWithoutSamples as skip } from "./fixtures.mjs";

// ------------------------------------------------------------------ numerics

test("half-precision floats round-trip at luminance-sized values", () => {
  for (const v of [0, 0.0001, 0.05, 0.5, 1, 10, 100, 400, 1000, 1500, 4000, 10000]) {
    const back = halfToFloat(floatToHalf(v));
    const tolerance = Math.max(v * 0.001, 1e-6);
    assert.ok(Math.abs(back - v) <= tolerance, `${v} came back as ${back}`);
  }
});

test("half-precision decodes known bit patterns", () => {
  assert.equal(halfToFloat(0x0000), 0);
  assert.equal(halfToFloat(0x3c00), 1);
  assert.equal(halfToFloat(0x4000), 2);
  assert.equal(halfToFloat(0x5640), 100);
});

test("ColorCoord12 packs two 12-bit values into three bytes", () => {
  for (const c of [{ x: 0, y: 0 }, { x: 4095, y: 4095 }, { x: 0x123, y: 0xabc }, { x: 2550, y: 1288 }]) {
    const out = [];
    writeColorCoord12(c, out);
    assert.equal(out.length, 3);
    const back = readColorCoord12(Uint8Array.from(out), 0);
    assert.deepEqual(back, c, `${JSON.stringify(c)} -> ${JSON.stringify(back)}`);
  }
});

// -------------------------------------------------------------- block codecs

function sampleDisplayParamsV2() {
  return {
    horizontalImageSizeRaw: 6970,      // 697.0 mm
    verticalImageSizeRaw: 3922,
    horizontalPixelCount: 3840,
    verticalPixelCount: 2160,
    scanOrientation: 0,
    luminanceInfo: 1,
    colorSpaceCie1976: false,
    audioSpeakerNotIntegrated: false,
    reservedFeature: false,
    primary1: { x: 2703, y: 1352 },
    primary2: { x: 1229, y: 2949 },
    primary3: { x: 614, y: 246 },
    white: { x: 1290, y: 1356 },
    maxLuminanceFull: floatToHalf(600),
    maxLuminance10Percent: floatToHalf(1000),
    minLuminance: floatToHalf(0.05),
    nativeColorDepth: 3,
    displayDeviceTechnology: 2,
    gammaRaw: 120,
    trailing: new Uint8Array(0),
  };
}

test("Display Parameters v2 round-trips and is 29 bytes", () => {
  const built = buildDisplayParamsV2(sampleDisplayParamsV2());
  assert.equal(built.length, DISPLAY_PARAMS_V2_LENGTH);
  const parsed = parseDisplayParamsV2(built);
  assert.ok(bytesEqual(built, buildDisplayParamsV2(parsed)), "second build differed");
  assert.equal(parsed.horizontalPixelCount, 3840);
  assert.equal(parsed.verticalPixelCount, 2160);
  assert.equal(parsed.nativeColorDepth, 3);
  assert.equal(parsed.displayDeviceTechnology, 2);
  assert.ok(Math.abs(halfToFloat(parsed.maxLuminanceFull) - 600) < 1);
  assert.ok(Math.abs(coordToCie(parsed.primary1.x) - 0.6599) < 0.001);
});

test("Display Parameters v2 rejects a short payload", () => {
  assert.throws(() => parseDisplayParamsV2(new Uint8Array(10)), /29 required/);
});

test("Adaptive-Sync descriptors round-trip, including the inverted seamless bit", () => {
  const v = {
    descriptors: [
      {
        nativePanelRange: true, frameDurationIncreaseTolerant: true,
        frameDurationDecreaseTolerant: false, supportedModes: 1,
        seamlessTransition: true, maxSingleFrameIncreaseCode: 40,
        minRefreshRateHz: 48, maxRefreshRateHz: 240, maxSingleFrameDecreaseCode: 20,
      },
      {
        nativePanelRange: false, frameDurationIncreaseTolerant: false,
        frameDurationDecreaseTolerant: true, supportedModes: 2,
        seamlessTransition: false, maxSingleFrameIncreaseCode: 0,
        minRefreshRateHz: 24, maxRefreshRateHz: 60, maxSingleFrameDecreaseCode: 255,
      },
    ],
    trailing: new Uint8Array(0),
  };
  const bytes = buildAdaptiveSync(v);
  assert.equal(bytes.length, 12);
  const back = parseAdaptiveSync(bytes);
  assert.deepEqual(back.descriptors, v.descriptors);
  assert.equal(back.descriptors[0].maxRefreshRateHz, 240);
  assert.equal(singleFrameDeltaPercent(back.descriptors[0].maxSingleFrameIncreaseCode), 10);
});

test("Tiled topology round-trips 6-bit split counts and locations", () => {
  const t = {
    tileCapabilities: 0x80,
    horizontalTileCount: 33, verticalTileCount: 17,   // exercise the high 2 bits
    horizontalLocation: 20, verticalLocation: 9,
    horizontalSize: 1920, verticalSize: 1080,
    pixelMultiplier: 0,
    bezel: { top: 1, bottom: 2, right: 3, left: 4 },
    vendorId: Uint8Array.from([0x11, 0x22, 0x33]),
    productCode: 4660, serialNumber: 305419896,
    trailing: new Uint8Array(0),
  };
  const bytes = buildTiledTopology(t);
  assert.equal(bytes.length, TILED_TOPOLOGY_LENGTH);
  const back = parseTiledTopology(bytes);
  assert.equal(back.horizontalTileCount, 33);
  assert.equal(back.verticalTileCount, 17);
  assert.equal(back.horizontalLocation, 20);
  assert.equal(back.verticalLocation, 9);
  assert.equal(back.horizontalSize, 1920);
  assert.equal(back.serialNumber, 305419896);
  assert.ok(bytesEqual(bytes, buildTiledTopology(back)));
});

test("ContainerID formats as a UUID", () => {
  const id = Uint8Array.from([...Array(16).keys()].map((i) => i * 17));
  assert.match(formatContainerId(id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("tag labels cover both DisplayID generations", () => {
  assert.equal(didTagLabel(DidTag.DisplayParamsV1), "Display Parameters");
  assert.equal(didTagLabel(DidTag.DisplayParamsV2), "Display Parameters v2");
  assert.equal(didTagLabel(DidTag.AdaptiveSync), "Adaptive Sync");
  assert.equal(didTagLabel(DidTag.TimingX), "Type X Timing - Formula Based");
  assert.match(didTagLabel(0x1a), /Reserved \(VESA\)/);
  assert.equal(isV2Tag(DidTag.DisplayParamsV2), true);
  assert.equal(isV2Tag(DidTag.DisplayParamsV1), false);
});

// ---------------------------------------------------- whole-EDID integration

/** Build a real EDID carrying a DisplayID 2.0 extension. */
function buildDisplayId2Edid() {
  const base = decodeEdid(
    parseEdidXml(readFileSync(`${SAMPLES_DIR}/NoVSDB.xml`, "utf8")),
  ).base;

  const dataBlocks = [
    { tag: DidTag.DisplayParamsV2, revision: 0, payload: buildDisplayParamsV2(sampleDisplayParamsV2()) },
    {
      tag: DidTag.AdaptiveSync,
      revision: 0,
      payload: buildAdaptiveSync({
        descriptors: [{
          nativePanelRange: true, frameDurationIncreaseTolerant: false,
          frameDurationDecreaseTolerant: false, supportedModes: 0,
          seamlessTransition: true, maxSingleFrameIncreaseCode: 40,
          minRefreshRateHz: 48, maxRefreshRateHz: 165, maxSingleFrameDecreaseCode: 40,
        }],
        trailing: new Uint8Array(0),
      }),
    },
    { tag: DidTag.ContainerId, revision: 0, payload: Uint8Array.from([...Array(16).keys()]) },
  ];

  return {
    base: { ...base, extensionCount: 1 },
    extensions: [{
      kind: "displayid",
      version: 2,
      revision: 0,
      productType: 1,          // primary use case: desktop productivity
      sourceSectionSize: 0,
      extensionCount: 0,
      dataBlocks,
      padding: new Uint8Array(0),
      sectionChecksum: 0,
    }],
  };
}

test("a DisplayID 2.0 EDID encodes, decodes and round-trips byte-exactly", { skip }, () => {
  const edid = buildDisplayId2Edid();
  const bytes = encodeEdid(edid);

  assert.equal(bytes.length, 256, "expected base block plus one extension");
  for (const [i, b] of splitBlocks(bytes).entries()) {
    assert.ok(isChecksumValid(b), `block ${i} checksum invalid`);
  }

  const again = encodeEdid(decodeEdid(bytes));
  assert.ok(bytesEqual(bytes, again), `round-trip differed:\n  ${bytesToHex(bytes)}\n  ${bytesToHex(again)}`);
});

test("DisplayID 2.0 blocks surface as real fields in the matrix", { skip }, () => {
  const edid = decodeEdid(encodeEdid(buildDisplayId2Edid()));
  const fields = flattenEdid(edid);
  const get = (suffix) => fields.find((f) => f.path.endsWith(suffix))?.value;

  assert.equal(get("did0.version"), "2.0");
  assert.equal(get(".useCase"), 1);
  assert.equal(get(".hPixels"), 3840);
  assert.equal(get(".vPixels"), 2160);
  // Enumerations carry the raw code as the value and name it in the label, so
  // the writer can take the value straight back. A label in `value` has broken
  // the round-trip twice; `describeInput` supplies the dropdown text instead.
  const label = (suffix) => fields.find((f) => f.path.endsWith(suffix))?.label ?? "";
  assert.equal(get(".colorDepth"), 3, "native colour depth code for 10 bpc");
  assert.match(label(".colorDepth"), /10 bpc/);
  assert.equal(typeof get(".tech"), "number");
  assert.match(label(".tech"), /OLED/);
  assert.equal(get(".minHz"), 48);
  assert.equal(get(".maxHz"), 165);
  assert.match(String(get(".uuid")), /^[0-9a-f]{8}-/);

  const maxLum = Number(get(".maxLum"));
  assert.ok(Math.abs(maxLum - 600) < 1, `max luminance was ${maxLum}`);

  // Labels must name the blocks, not just show hex.
  const labels = fields.map((f) => f.label).join(" | ");
  assert.match(labels, /Display Parameters v2/);
  assert.match(labels, /Adaptive Sync/);
  assert.match(labels, /ContainerID/);
});
