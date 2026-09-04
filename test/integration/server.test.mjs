/**
 * Server integration tests.
 *
 * Boots the real server against a throwaway project directory and drives it
 * over HTTP, so the file-management routes are exercised the way the browser
 * uses them. No test doubles: what passes here is what the UI will get.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeEdid, encodeEdid, splitBlocks, isChecksumValid, bytesEqual, hexToBytes, bytesToHex,
  createBlankEdid, flattenEdid,
} from "../../packages/edid-core/dist/index.js";
import { serialiseEdidDdc, serialiseEdidXml } from "../../packages/edid-io/dist/index.js";

const PORT = Number(process.env.EDID_TEST_PORT ?? 5321);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let projectDir;

async function api(path, init) {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const json = (method, payload) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

/** Poll until the server answers, so the suite never races the boot. */
async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(BASE + "/api/project");
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server did not start on ${PORT}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

before(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "edid-it-"));
  child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    env: { ...process.env, PORT: String(PORT), EDID_PROJECT_DIR: projectDir },
    stdio: "ignore",
  });
  await waitForServer();
});

after(async () => {
  child?.kill();
  if (projectDir) await rm(projectDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------------ I1

test("I1: a new file is a valid EDID with correct checksums", async () => {
  const { status, body } = await api("/api/file", json("POST", { path: "new/PANEL-A", productName: "PANEL A" }));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.path, "new/PANEL-A.ddc", "extension should be forced to .ddc");

  const bytes = hexToBytes(body.hex);
  assert.equal(bytes.length % 128, 0);
  for (const [i, b] of splitBlocks(bytes).entries()) {
    assert.ok(isChecksumValid(b), `block ${i} checksum invalid`);
  }
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0, 255, 255, 255, 255, 255, 255, 0]);

  // On disk it must be canonical .ddc text, not XML.
  const onDisk = await readFile(join(projectDir, "new/PANEL-A.ddc"), "utf8");
  assert.equal(onDisk, serialiseEdidDdc(bytes));
  assert.match(onDisk, /^[0-9A-F]+$/, "saved .ddc must be uppercase contiguous hex");
});

test("I1b: creating over an existing file is refused", async () => {
  const { status, body } = await api("/api/file", json("POST", { path: "new/PANEL-A.ddc" }));
  assert.equal(status, 400);
  assert.match(body.error, /already exists/);
});

// ------------------------------------------------------------------------ I2

test("I2: .xml, .bin and spaced hex all import to identical bytes", async () => {
  const source = encodeEdid(createBlankEdid({ productName: "IMPORT SRC" }));
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const hex = serialiseEdidDdc(source);

  // Targets are distinct because every import normalises to .ddc — "a.xml" and
  // "a.bin" would collide, which the server refuses (see I2c).
  const cases = [
    ["from-xml", "legacy.xml", b64(Buffer.from(serialiseEdidXml(source), "utf8"))],
    ["from-bin", "legacy.bin", b64(source)],
    ["from-spaced", "spaced.ddc", b64(Buffer.from(hex.match(/../g).join(" "), "utf8"))],
    ["from-dump", "dump.ddc",
      b64(Buffer.from(hex.match(/.{1,32}/g).map((l, i) => `${i * 16}: ${l}`).join("\n"), "utf8"))],
  ];

  for (const [target, sourceName, base64] of cases) {
    const { status, body } = await api("/api/import",
      json("POST", { path: "imported/" + target, sourceName, base64 }));
    assert.equal(status, 200, `${sourceName}: ${JSON.stringify(body)}`);
    assert.ok(bytesEqual(hexToBytes(body.hex), source), `${sourceName} did not import byte-exactly`);
    assert.equal(body.path, "imported/" + target + ".ddc", `${sourceName} should be stored as .ddc`);
  }
});

test("I2c: an import that would overwrite is refused unless asked", async () => {
  const source = encodeEdid(createBlankEdid({ productName: "COLLIDE" }));
  const base64 = Buffer.from(serialiseEdidDdc(source), "utf8").toString("base64");
  const payload = { path: "imported/collide.ddc", sourceName: "collide.ddc", base64 };

  assert.equal((await api("/api/import", json("POST", payload))).status, 200);
  assert.equal((await api("/api/import", json("POST", payload))).status, 400);
  assert.equal((await api("/api/import", json("POST", { ...payload, overwrite: true }))).status, 200);
});

test("I2b: a file that is not an EDID is refused with a readable message", async () => {
  const base64 = Buffer.from("hello, this is not an edid", "utf8").toString("base64");
  const { status, body } = await api("/api/import",
    json("POST", { path: "imported/junk.ddc", sourceName: "junk.ddc", base64 }));
  assert.equal(status, 400);
  assert.match(body.error, /hex|EDID header/i, `unhelpful message: ${body.error}`);
});

// ------------------------------------------------------------------------ I3

test("I3: the tree mirrors the directory structure on disk", async () => {
  await mkdir(join(projectDir, "G80SD/HDMI"), { recursive: true });
  await mkdir(join(projectDir, "G80SD/DP"), { recursive: true });
  const bytes = encodeEdid(createBlankEdid({ productName: "G80SD" }));
  await writeFile(join(projectDir, "G80SD/HDMI/vrr.ddc"), serialiseEdidDdc(bytes), "utf8");

  const { status, body } = await api("/api/tree");
  assert.equal(status, 200);

  const model = body.tree.dirs.find((d) => d.name === "G80SD");
  assert.ok(model, "model folder missing from the tree");
  assert.deepEqual(model.dirs.map((d) => d.name), ["DP", "HDMI"], "subfolders should be listed and sorted");

  const dp = model.dirs.find((d) => d.name === "DP");
  assert.deepEqual(dp.files, [], "an empty model folder must still appear");

  const hdmi = model.dirs.find((d) => d.name === "HDMI");
  assert.deepEqual(hdmi.files.map((f) => f.path), ["G80SD/HDMI/vrr.ddc"]);

  assert.ok(body.files.some((f) => f.path === "G80SD/HDMI/vrr.ddc"), "flat list should include nested files");
});

test("I3b: legacy .xml/.bin sitting in the project are not listed", async () => {
  await writeFile(join(projectDir, "legacy-visible.xml"), serialiseEdidXml(encodeEdid(createBlankEdid())), "utf8");
  const { body } = await api("/api/tree");
  assert.ok(!body.files.some((f) => f.name.endsWith(".xml")), ".xml must not appear in the working list");
});

// ------------------------------------------------------------------------ I4

test("I4: an edit persists and touches only the bytes it should", async () => {
  const created = (await api("/api/file", json("POST", { path: "edit/target.ddc" }))).body;
  const before = hexToBytes(created.hex);

  const edid = decodeEdid(before);
  edid.base.productCode = 0x4d2;
  const after = encodeEdid(edid);

  const saved = await api("/api/edid", json("PUT", { path: created.path, hex: bytesToHex(after) }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const reloaded = await api("/api/edid?path=" + encodeURIComponent(created.path));
  assert.equal(reloaded.status, 200);
  const back = hexToBytes(reloaded.body.hex);

  const value = flattenEdid(decodeEdid(back)).find((f) => f.path === "base.productCode")?.value;
  assert.equal(value, 0x4d2, "edited value did not survive the round trip");

  // productCode is bytes 10-11; the checksum at 127 necessarily moves with it.
  const changed = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== back[i]) changed.push(i);
  assert.deepEqual(changed, [10, 11, 127], `unexpected bytes changed: ${changed}`);
});

// ------------------------------------------------------------------------ I5

test("I5: everything the server writes has valid checksums", async () => {
  const { body } = await api("/api/tree");
  assert.ok(body.files.length > 0, "nothing was written by the earlier tests");

  for (const f of body.files) {
    const doc = await api("/api/edid?path=" + encodeURIComponent(f.path));
    assert.equal(doc.status, 200, `${f.path}: ${JSON.stringify(doc.body)}`);
    for (const b of doc.body.blocks) {
      assert.ok(b.checksumValid, `${f.path} block ${b.index} has an invalid checksum`);
    }
  }
});

// ------------------------------------------------------------------------ I6

test("I6: duplicate copies bytes exactly", async () => {
  const src = (await api("/api/file", json("POST", { path: "roll/base.ddc", productName: "BASE" }))).body;
  const dup = await api("/api/duplicate", json("POST", { from: src.path, to: "roll/derived-1" }));

  assert.equal(dup.status, 200, JSON.stringify(dup.body));
  assert.equal(dup.body.path, "roll/derived-1.ddc");
  assert.equal(dup.body.hex, src.hex, "duplicate is not byte-identical to its source");

  const again = await api("/api/duplicate", json("POST", { from: src.path, to: "roll/derived-1.ddc" }));
  assert.equal(again.status, 400, "duplicating onto an existing file must be refused");
});

// ------------------------------------------------------------------------ I7

test("I7: paths outside the project directory are refused", async () => {
  const escapes = ["../escape.ddc", "a/../../escape.ddc", "C:/Windows/escape.ddc", "/etc/passwd", ""];
  for (const p of escapes) {
    const read = await api("/api/edid?path=" + encodeURIComponent(p));
    assert.equal(read.status, 400, `read of ${JSON.stringify(p)} should be refused`);

    const write = await api("/api/edid", json("PUT", { path: p, hex: "00" }));
    assert.equal(write.status, 400, `write to ${JSON.stringify(p)} should be refused`);

    const create = await api("/api/file", json("POST", { path: p }));
    assert.equal(create.status, 400, `create of ${JSON.stringify(p)} should be refused`);
  }
});

// ------------------------------------------------------------------------ I8

test("I8: a rejected write leaves the file untouched", async () => {
  const created = (await api("/api/file", json("POST", { path: "reject/keep.ddc" }))).body;
  const original = await readFile(join(projectDir, "reject/keep.ddc"), "utf8");

  for (const hex of ["", "not-hex", "00FF", "0".repeat(254)]) {
    const res = await api("/api/edid", json("PUT", { path: created.path, hex }));
    assert.equal(res.status, 400, `hex ${JSON.stringify(hex.slice(0, 12))} should be refused`);
  }

  assert.equal(await readFile(join(projectDir, "reject/keep.ddc"), "utf8"), original,
    "a refused write must not modify the file");
});

test("I8b: delete removes the file and is then a clean 400", async () => {
  const created = (await api("/api/file", json("POST", { path: "gone/bye.ddc" }))).body;
  const first = await api("/api/edid?path=" + encodeURIComponent(created.path), { method: "DELETE" });
  assert.equal(first.status, 200);

  const second = await api("/api/edid?path=" + encodeURIComponent(created.path), { method: "DELETE" });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /no such file/);
});
