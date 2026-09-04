import express from "express";
import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, extname, basename, dirname, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeEdid, encodeEdid, flattenEdid, bytesToHex, hexToBytes, splitBlocks, isChecksumValid,
  createBlankEdid,
} from "@edid/core";
import { parseEdidXml, parseEdidBin, parseEdidDdc, serialiseEdidDdc } from "@edid/io";

const PORT = Number(process.env.PORT ?? 5177);
const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");

/** Project directory holding the EDID files being worked on. */
let projectDir = resolve(process.env.EDID_PROJECT_DIR ?? join(repoRoot, "projects"));

const app = express();
app.use(express.json({ limit: "4mb" }));

// ------------------------------------------------------------------ helpers

/**
 * Reject anything that would escape the project directory.
 *
 * An absolute input is rejected outright: on Windows `relative()` between two
 * different drives returns a drive-qualified path that starts with neither ".."
 * nor a separator, so the containment check alone would let `C:\...` through
 * while the project sits on `D:\`.
 */
function resolveInProject(relPath: string): string {
  if (relPath === "" || isAbsolute(relPath)) throw new Error("path must be relative to the project directory");
  const full = resolve(projectDir, relPath);
  const rel = relative(projectDir, full);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep) || isAbsolute(rel)) {
    throw new Error("path escapes the project directory");
  }
  return full;
}

/** `.ddc` is the working format; the listing shows nothing else. */
function isEdidFile(name: string): boolean {
  return extname(name).toLowerCase() === ".ddc";
}

/** Read a working file from disk and return its raw EDID bytes. */
async function readEdidBytes(fullPath: string): Promise<Uint8Array> {
  return parseEdidDdc(new Uint8Array(await readFile(fullPath)));
}

/**
 * Convert an imported file to EDID bytes. `.xml` and `.bin` are read-only
 * legacy formats — they come in through here and are saved back out as `.ddc`.
 */
function importedBytes(sourceName: string, raw: Uint8Array): Uint8Array {
  switch (extname(sourceName).toLowerCase()) {
    case ".xml": return parseEdidXml(Buffer.from(raw).toString("utf8"));
    case ".bin": return parseEdidBin(raw);
    default:     return parseEdidDdc(raw);   // .ddc, .txt, or any hex dump
  }
}

/** Write EDID bytes as canonical `.ddc`, creating the parent folder if needed. */
async function writeDdc(fullPath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, serialiseEdidDdc(bytes), "utf8");
}

/** Force a `.ddc` extension on a user-supplied name. */
function asDdcPath(relPath: string): string {
  const ext = extname(relPath).toLowerCase();
  return ext === ".ddc" ? relPath : relPath.replace(/\.[^./\\]*$/, "") + ".ddc";
}

/** Everything the UI needs about one EDID file. */
function describe(path: string, bytes: Uint8Array) {
  const edid = decodeEdid(bytes);
  const blocks = splitBlocks(bytes).map((b, i) => ({
    index: i,
    hex: bytesToHex(b),
    checksumValid: isChecksumValid(b),
  }));
  return {
    path,
    name: basename(path),
    hex: bytesToHex(bytes),
    blocks,
    fields: flattenEdid(edid),
    edid,
  };
}

function fail(res: express.Response, status: number, err: unknown) {
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

// --------------------------------------------------------------------- API

app.get("/api/project", (_req, res) => {
  res.json({ dir: projectDir, exists: existsSync(projectDir) });
});

app.post("/api/project", async (req, res) => {
  const dir = String(req.body?.dir ?? "").trim();
  if (!dir) return fail(res, 400, new Error("dir is required"));
  const full = resolve(dir);
  try {
    const s = await stat(full);
    if (!s.isDirectory()) throw new Error("not a directory");
    projectDir = full;
    res.json({ dir: projectDir });
  } catch (e) {
    fail(res, 400, e);
  }
});

/**
 * Nested directory listing.
 *
 * Real projects are organised by model: a model folder holds port/mode
 * subfolders, and .ddc files sit at whichever level the capture put them —
 * measured depth in the reference corpus runs from 2 to 7. So this returns a
 * tree, and it keeps folders that hold no EDID directly, because they still
 * carry the model's structure.
 */
interface DirNode {
  name: string;
  path: string;
  dirs: DirNode[];
  files: { path: string; name: string; size: number; modified: number }[];
}

async function readTree(fullDir: string, relDir: string): Promise<DirNode> {
  const node: DirNode = { name: basename(fullDir), path: relDir, dirs: [], files: [] };
  let entries;
  try {
    entries = await readdir(fullDir, { withFileTypes: true });
  } catch {
    return node;   // unreadable folder: report it empty rather than failing the whole tree
  }

  for (const e of entries) {
    const full = join(fullDir, e.name);
    const rel = relDir ? relDir + "/" + e.name : e.name;
    if (e.isDirectory()) {
      node.dirs.push(await readTree(full, rel));
    } else if (e.isFile() && isEdidFile(e.name)) {
      const s = await stat(full);
      node.files.push({ path: rel, name: e.name, size: s.size, modified: s.mtimeMs });
    }
  }

  node.dirs.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));
  return node;
}

/** Flatten a tree to the file list the matrix works from. */
function treeFiles(node: DirNode): DirNode["files"] {
  return [...node.files, ...node.dirs.flatMap(treeFiles)];
}

app.get("/api/tree", async (_req, res) => {
  try {
    if (!existsSync(projectDir)) await mkdir(projectDir, { recursive: true });
    const tree = await readTree(projectDir, "");
    res.json({ dir: projectDir, tree, files: treeFiles(tree) });
  } catch (e) {
    fail(res, 500, e);
  }
});

app.get("/api/edid", async (req, res) => {
  const rel = String(req.query.path ?? "");
  try {
    const bytes = await readEdidBytes(resolveInProject(rel));
    res.json(describe(rel, bytes));
  } catch (e) {
    fail(res, 400, e);
  }
});

/** Decode arbitrary hex without touching disk — used by the paste-hex flows. */
app.post("/api/decode", (req, res) => {
  try {
    const bytes = hexToBytes(String(req.body?.hex ?? ""));
    res.json(describe(String(req.body?.name ?? "(pasted)"), bytes));
  } catch (e) {
    fail(res, 400, e);
  }
});

app.put("/api/edid", async (req, res) => {
  const rel = String(req.body?.path ?? "");
  const hex = String(req.body?.hex ?? "");
  try {
    const full = resolveInProject(rel);
    // Re-encode through the model so checksums are always correct on the way out.
    const bytes = encodeEdid(decodeEdid(hexToBytes(hex)));
    await writeDdc(full, bytes);
    res.json(describe(rel, bytes));
  } catch (e) {
    fail(res, 400, e);
  }
});

// ------------------------------------------------------------ file management

/** Refuse to clobber an existing file — creation is never destructive. */
async function assertFree(full: string): Promise<void> {
  if (existsSync(full)) throw new Error(`${basename(full)} already exists`);
}

app.post("/api/file", async (req, res) => {
  const rel = String(req.body?.path ?? "").trim();
  if (!rel) return fail(res, 400, new Error("path is required"));
  try {
    const target = asDdcPath(rel);
    const full = resolveInProject(target);
    await assertFree(full);

    const bytes = encodeEdid(createBlankEdid({
      manufacturerId: req.body?.manufacturerId ? String(req.body.manufacturerId) : undefined,
      productName: req.body?.productName ? String(req.body.productName) : basename(target, ".ddc"),
    }));
    await writeDdc(full, bytes);
    res.json(describe(target, bytes));
  } catch (e) {
    fail(res, 400, e);
  }
});

/**
 * Import a `.ddc`, `.xml` or `.bin` and store it as `.ddc`.
 *
 * The browser sends the raw file base64-encoded, so one route covers text and
 * binary sources without pulling in a multipart parser.
 */
app.post("/api/import", async (req, res) => {
  const rel = String(req.body?.path ?? "").trim();
  const sourceName = String(req.body?.sourceName ?? rel);
  const base64 = String(req.body?.base64 ?? "");
  if (!rel) return fail(res, 400, new Error("path is required"));
  try {
    const target = asDdcPath(rel);
    const full = resolveInProject(target);
    if (!req.body?.overwrite) await assertFree(full);

    const raw = new Uint8Array(Buffer.from(base64, "base64"));
    if (raw.length === 0) throw new Error("file is empty");

    // Import preserves the source bytes exactly; it does not re-encode, so a
    // file with a bad checksum is reported rather than silently repaired.
    const bytes = importedBytes(sourceName, raw);
    decodeEdid(bytes);   // validate before writing
    await writeDdc(full, bytes);
    res.json(describe(target, bytes));
  } catch (e) {
    fail(res, 400, e);
  }
});

/** Copy an existing file under a new name — the start of a horizontal rollout. */
app.post("/api/duplicate", async (req, res) => {
  const from = String(req.body?.from ?? "").trim();
  const to = String(req.body?.to ?? "").trim();
  if (!from || !to) return fail(res, 400, new Error("from and to are required"));
  try {
    const src = resolveInProject(from);
    const target = asDdcPath(to);
    const dst = resolveInProject(target);
    await assertFree(dst);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    res.json(describe(target, await readEdidBytes(dst)));
  } catch (e) {
    fail(res, 400, e);
  }
});

app.post("/api/dir", async (req, res) => {
  const rel = String(req.body?.path ?? "").trim();
  if (!rel) return fail(res, 400, new Error("path is required"));
  try {
    const full = resolveInProject(rel);
    await assertFree(full);
    await mkdir(full, { recursive: true });
    res.json({ path: rel });
  } catch (e) {
    fail(res, 400, e);
  }
});

app.delete("/api/edid", async (req, res) => {
  const rel = String(req.query.path ?? req.body?.path ?? "").trim();
  if (!rel) return fail(res, 400, new Error("path is required"));
  try {
    const full = resolveInProject(rel);
    if (!existsSync(full)) throw new Error("no such file");
    await rm(full, { recursive: true });
    res.json({ path: rel, deleted: true });
  } catch (e) {
    fail(res, 400, e);
  }
});

// ------------------------------------------------------- static web bundle

const webDist = join(repoRoot, "apps/web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(join(webDist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`EDID Workbench API on http://localhost:${PORT}`);
  console.log(`project directory: ${projectDir}`);
});
