import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeEdid, encodeEdid, flattenEdid, applyField, isFieldEditable,
  bytesToHex, hexToBytes, describeCount,
  addExtension, addCtaBlock, addDisplayIdBlock, removeAtPath, setListCount,
  structureTargetFor, addTargetFor, ctaBlockCatalogue, displayIdBlockCatalogue,
  type Edid, type SpecField,
} from "@edid/core";
import { api, fileToBase64, type DirNode, type FileEntry } from "./api.js";
import { FileTree } from "./FileTree.js";
import { MatrixView } from "./MatrixView.js";
import { HexPanel } from "./HexPanel.js";
import { PromptDialog, ConfirmDialog, PickerDialog } from "./PromptDialog.js";

/** One model in the matrix: a file on disk plus its live, edited state. */
export interface Column {
  path: string;
  name: string;
  edid: Edid;
  originalHex: string;
  dirty: boolean;
}

type DialogState =
  | { kind: "new-file"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "duplicate"; from: string }
  | { kind: "delete"; path: string }
  | { kind: "close-dirty"; index: number }
  | { kind: "add-extension"; column: number }
  | { kind: "add-block"; column: number; extIndex: number; catalogue: "cta" | "displayid" }
  | null;

export function App() {
  const [dir, setDir] = useState("");
  const [tree, setTree] = useState<DirNode | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [baseline, setBaseline] = useState(0);
  const [focused, setFocused] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<SpecField[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [flashBytes, setFlashBytes] = useState<Set<number>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const importDir = useRef<string>("");

  const refreshTree = useCallback(async () => {
    try {
      const r = await api.tree();
      setDir(r.dir);
      setTree(r.tree);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refreshTree(); }, [refreshTree]);

  const loadedPaths = useMemo(() => new Set(columns.map((c) => c.path)), [columns]);

  const loadFile = async (path: string, name: string) => {
    try {
      const doc = await api.load(path);
      setColumns((cols) => [
        ...cols,
        { path, name, edid: decodeEdid(hexToBytes(doc.hex)), originalHex: doc.hex, dirty: false },
      ]);
      setError(null);
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const closeColumn = (index: number) => {
    setColumns((cols) => cols.filter((_, i) => i !== index));
    setBaseline((b) => (b >= index && b > 0 ? b - 1 : b));
    setFocused((f) => (f >= index && f > 0 ? f - 1 : f));
  };

  const toggleFile = (file: FileEntry) => {
    const idx = columns.findIndex((c) => c.path === file.path);
    if (idx === -1) {
      void loadFile(file.path, file.name);
      return;
    }
    if (columns[idx]?.dirty) {
      setDialog({ kind: "close-dirty", index: idx });
      return;
    }
    closeColumn(idx);
  };

  // --------------------------------------------------------------- fields

  /** flattenEdid with real bytes when the model still encodes cleanly. */
  const fieldsByColumn = useMemo<SpecField[][]>(() => {
    return columns.map((c) => {
      try {
        return flattenEdid(c.edid, encodeEdid(c.edid));
      } catch {
        return flattenEdid(c.edid);
      }
    });
  }, [columns]);

  // ------------------------------------------------------------- editing

  const flash = (bytes: Set<number>) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashBytes(bytes);
    flashTimer.current = setTimeout(() => setFlashBytes(new Set()), 900);
  };

  /** Write one field into one column. Mutates in place, then re-issues the array. */
  const editCell = useCallback((colIndex: number, path: string, value: string | number | boolean) => {
    setColumns((cols) => {
      const col = cols[colIndex];
      if (!col) return cols;

      let before: Uint8Array | null = null;
      try { before = encodeEdid(col.edid); } catch { /* mid-edit already */ }

      try {
        if (!applyField(col.edid, path, value)) {
          setError(`"${path}" is not writable on ${col.name}`);
          return cols;
        }
        setError(null);
      } catch (e) {
        setError(`${col.name}: ${e instanceof Error ? e.message : String(e)}`);
        return cols;
      }

      if (colIndex === focused && before) {
        try {
          const after = encodeEdid(col.edid);
          const changed = new Set<number>();
          const n = Math.max(before.length, after.length);
          for (let i = 0; i < n; i++) if (before[i] !== after[i]) changed.add(i);
          flash(changed);
        } catch { /* can't diff a model that no longer encodes */ }
      }

      const next = [...cols];
      next[colIndex] = { ...col, dirty: true };
      return next;
    });
    setSelectedPath(path);
  }, [focused]);

  // ---------------------------------------------------------- structure

  /**
   * Structural edits go through the same mutate-then-flag path as field edits,
   * so an add or a remove marks the column dirty and the byte flash shows what
   * moved. The core validates by encoding and rolls back on overflow, so a
   * refusal here means the model is untouched — the message is the reason.
   */
  const mutateStructure = useCallback((colIndex: number, run: (edid: Edid) => boolean) => {
    setColumns((cols) => {
      const col = cols[colIndex];
      if (!col) return cols;
      let before: Uint8Array | null = null;
      try { before = encodeEdid(col.edid); } catch { /* mid-edit */ }

      try {
        if (!run(col.edid)) {
          setError("That structural change does not apply to " + col.name);
          return cols;
        }
        setError(null);
      } catch (e) {
        setError(col.name + ": " + (e instanceof Error ? e.message : String(e)));
        return cols;
      }

      if (before) {
        try {
          const after = encodeEdid(col.edid);
          const changed = new Set<number>();
          const n = Math.max(before.length, after.length);
          for (let i = 0; i < n; i++) if (before[i] !== after[i]) changed.add(i);
          flash(changed);
        } catch { /* cannot diff a model that no longer encodes */ }
      }

      const next = [...cols];
      next[colIndex] = { ...col, dirty: true };
      return next;
    });
  }, []);

  const structure = useMemo(() => ({
    canAdd: (col: number, path: string) => {
      const edid = columns[col]?.edid;
      return edid ? addTargetFor(edid, path) !== null : false;
    },
    canRemove: (col: number, path: string) => {
      const edid = columns[col]?.edid;
      if (!edid) return false;
      const target = structureTargetFor(edid, path);
      // A descriptor slot is blanked rather than removed, and the four slots
      // always exist, so it is not offered as a removal here.
      return target !== null && target.kind !== "descriptor";
    },
    onAdd: (col: number, path: string) => {
      const edid = columns[col]?.edid;
      if (!edid) return;
      const target = addTargetFor(edid, path);
      if (!target) return;
      setDialog({ kind: "add-block", column: col, extIndex: target.extIndex, catalogue: target.kind });
    },
    onRemove: (col: number, path: string) => mutateStructure(col, (edid) => removeAtPath(edid, path)),
    onSetCount: (col: number, path: string, n: number) =>
      mutateStructure(col, (edid) => setListCount(edid, path, n)),
    onAddExtension: (col: number) => setDialog({ kind: "add-extension", column: col }),
  }), [columns, mutateStructure]);

  /** Copy every writable field out of one column. */
  const copyColumn = (index: number) => {
    const col = columns[index];
    if (!col) return;
    // Group rows carrying a resizable count travel with the spec, so a paste
    // can grow the target's lists before filling them in.
    setClipboard(flattenEdid(col.edid).filter(
      (f) => isFieldEditable(f.path) || describeCount(f.path) !== null));
    setError(null);
  };

  /** Apply the clipboard to a set of columns — the horizontal spread. */
  const pasteInto = (targets: number[]) => {
    if (!clipboard) return;
    const skipped: string[] = [];
    setColumns((cols) => {
      const next = [...cols];
      for (const t of targets) {
        const col = next[t];
        if (!col) continue;
        let changed = false;
        // Two passes: list shapes first, then the indexed fields inside them.
        // A 10-entry spec pasted onto a 7-entry model would otherwise drop the
        // last three silently, because their rows do not exist yet.
        const isShape = (f: SpecField) =>
          describeCount(f.path) !== null || /\.(vics|codes|hdmiVics)$/.test(f.path);
        for (const pass of [clipboard.filter(isShape), clipboard.filter((f) => !isShape(f))]) {
          for (const f of pass) {
            if (f.value === null) continue;
            try {
              if (applyField(col.edid, f.path, f.value)) changed = true;
            } catch {
              skipped.push(`${col.name}: ${f.label}`);
            }
          }
        }
        if (changed) next[t] = { ...col, dirty: true };
      }
      return next;
    });
    setError(skipped.length ? `${skipped.length} field(s) did not apply: ${skipped.slice(0, 4).join(", ")}` : null);
  };

  /** Push the baseline's value for one field into every other column. */
  const propagateRow = (path: string) => {
    const source = columns[baseline];
    if (!source) return;
    const value = flattenEdid(source.edid).find((f) => f.path === path)?.value;
    if (value === undefined || value === null) return;
    setColumns((cols) => {
      const next = [...cols];
      cols.forEach((col, i) => {
        if (i === baseline) return;
        try {
          if (applyField(col.edid, path, value)) next[i] = { ...col, dirty: true };
        } catch { /* incompatible target: leave it alone */ }
      });
      return next;
    });
  };

  const saveColumn = async (index: number) => {
    const col = columns[index];
    if (!col) return;
    try {
      const hex = bytesToHex(encodeEdid(col.edid));
      await api.save(col.path, hex);
      setColumns((cols) => {
        const next = [...cols];
        const c = next[index];
        if (c) next[index] = { ...c, dirty: false, originalHex: hex };
        return next;
      });
      setError(null);
      void refreshTree();
    } catch (e) {
      setError(`Save failed for ${col.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveAll = async () => {
    for (let i = 0; i < columns.length; i++) if (columns[i]?.dirty) await saveColumn(i);
  };

  const revertColumn = (index: number) => {
    setColumns((cols) => {
      const col = cols[index];
      if (!col) return cols;
      const next = [...cols];
      next[index] = { ...col, edid: decodeEdid(hexToBytes(col.originalHex)), dirty: false };
      return next;
    });
  };

  // ------------------------------------------------------- file management

  const createFile = async (relDir: string, name: string) => {
    const path = relDir ? `${relDir}/${name}` : name;
    try {
      const doc = await api.create(path, name.replace(/\.ddc$/i, ""));
      await refreshTree();
      await loadFile(doc.path, doc.name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createFolder = async (relDir: string, name: string) => {
    const path = relDir ? `${relDir}/${name}` : name;
    try {
      await api.makeDir(path);
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const duplicateFile = async (from: string, toName: string) => {
    const dirPart = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    const to = dirPart ? `${dirPart}/${toName}` : toName;
    try {
      const doc = await api.duplicate(from, to);
      await refreshTree();
      await loadFile(doc.path, doc.name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteFile = async (path: string) => {
    const idx = columns.findIndex((c) => c.path === path);
    if (idx !== -1) closeColumn(idx);
    try {
      await api.remove(path);
      await refreshTree();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importFiles = async (relDir: string, files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        const base64 = await fileToBase64(file);
        const target = relDir ? `${relDir}/${file.name}` : file.name;
        const doc = await api.import(target, file.name, base64);
        await refreshTree();
        await loadFile(doc.path, doc.name);
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const dirtyCount = columns.filter((c) => c.dirty).length;
  const focusedColumn = columns[Math.min(focused, Math.max(columns.length - 1, 0))];
  const focusedFields = fieldsByColumn[Math.min(focused, Math.max(fieldsByColumn.length - 1, 0))] ?? [];
  const focusedBytes = focusedColumn ? tryEncode(focusedColumn.edid) : null;
  const focusedOriginal = focusedColumn ? hexToBytes(focusedColumn.originalHex) : null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>EDID Workbench</h1>
        <span className="spacer" />
        <span className="dir" title={dir}>{dir}</span>
        <button onClick={() => void refreshTree()}>Refresh</button>
        <button className="primary" disabled={dirtyCount === 0} onClick={() => void saveAll()}>
          Save all{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
        </button>
      </header>

      {error && <div className="banner" onClick={() => setError(null)}>{error}</div>}

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-head">
            <h2>Files</h2>
            <button title="New .ddc in the project root" onClick={() => setDialog({ kind: "new-file", dir: "" })}>New</button>
          </div>
          <FileTree
            tree={tree}
            loaded={loadedPaths}
            onToggle={toggleFile}
            onNewFile={(d) => setDialog({ kind: "new-file", dir: d })}
            onNewFolder={(d) => setDialog({ kind: "new-folder", dir: d })}
            onImport={(d) => { importDir.current = d; importInput.current?.click(); }}
            onDuplicate={(p) => setDialog({ kind: "duplicate", from: p })}
            onDelete={(p) => setDialog({ kind: "delete", path: p })}
            onDrop={(d, files) => void importFiles(d, files)}
          />
          <input
            ref={importInput}
            type="file"
            multiple
            accept=".ddc,.xml,.bin,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) void importFiles(importDir.current, e.target.files);
              e.target.value = "";
            }}
          />
        </aside>

        <main className="main">
          {columns.length === 0 ? (
            <div className="empty">
              <h3>Pick files to compare</h3>
              <p>
                Tick <code>.ddc</code> files on the left to load them as columns. Rows are spec
                fields, columns are models — set one column as the baseline and every value that
                differs is highlighted. No files yet? Use <strong>New</strong> or drop a file onto a folder.
              </p>
            </div>
          ) : (
            <>
              <MatrixView
                columns={columns}
                fieldsByColumn={fieldsByColumn}
                baseline={baseline}
                setBaseline={setBaseline}
                focused={focused}
                setFocused={setFocused}
                selectedPath={selectedPath}
                onSelectPath={setSelectedPath}
                onEdit={editCell}
                onCopyColumn={copyColumn}
                onPaste={pasteInto}
                onPropagateRow={propagateRow}
                onSave={saveColumn}
                onRevert={revertColumn}
                onClose={closeColumn}
                hasClipboard={clipboard !== null}
                structure={structure}
              />
              {focusedColumn && focusedBytes && (
                <HexPanel
                  name={focusedColumn.name}
                  bytes={focusedBytes}
                  originalBytes={focusedOriginal}
                  fields={focusedFields}
                  selectedPath={selectedPath}
                  flashBytes={flashBytes}
                  onSelectPath={setSelectedPath}
                />
              )}
            </>
          )}
        </main>
      </div>

      {dialog?.kind === "new-file" && (
        <PromptDialog
          title="New EDID file"
          label={dialog.dir ? `Name (in ${dialog.dir}/)` : "Name"}
          placeholder="MY-MODEL"
          confirmLabel="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => { setDialog(null); void createFile(dialog.dir, name); }}
        />
      )}
      {dialog?.kind === "new-folder" && (
        <PromptDialog
          title="New folder"
          label={dialog.dir ? `Name (in ${dialog.dir}/)` : "Name"}
          placeholder="MODEL-NAME"
          confirmLabel="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => { setDialog(null); void createFolder(dialog.dir, name); }}
        />
      )}
      {dialog?.kind === "duplicate" && (
        <PromptDialog
          title="Duplicate as"
          label="New name"
          defaultValue={suggestDuplicateName(dialog.from)}
          confirmLabel="Duplicate"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => { setDialog(null); void duplicateFile(dialog.from, name); }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="Delete file"
          body={`Delete "${dialog.path}"? This cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => { setDialog(null); void deleteFile(dialog.path); }}
        />
      )}
      {dialog?.kind === "add-extension" && (
        <PickerDialog
          title="Add extension block"
          options={[
            { id: "cta", label: "CTA-861 extension", group: "Extension" },
            { id: "displayid", label: "DisplayID 2.0 extension", group: "Extension" },
          ]}
          onCancel={() => setDialog(null)}
          onConfirm={(id) => {
            const col = dialog.column;
            setDialog(null);
            mutateStructure(col, (edid) => addExtension(edid, id as "cta" | "displayid"));
          }}
        />
      )}
      {dialog?.kind === "add-block" && (
        <PickerDialog
          title={dialog.catalogue === "cta" ? "Add CTA data block" : "Add DisplayID data block"}
          options={dialog.catalogue === "cta"
            ? ctaBlockCatalogue().map((c) => ({ id: c.id, label: c.label, group: c.group }))
            : displayIdBlockCatalogue().map((c) => ({
                id: String(c.tag), label: c.label, group: "DisplayID",
              }))}
          onCancel={() => setDialog(null)}
          onConfirm={(id) => {
            const { column, extIndex, catalogue } = dialog;
            setDialog(null);
            mutateStructure(column, (edid) => catalogue === "cta"
              ? addCtaBlock(edid, extIndex, id)
              : addDisplayIdBlock(edid, extIndex, Number(id)));
          }}
        />
      )}
      {dialog?.kind === "close-dirty" && (
        <ConfirmDialog
          title="Discard changes?"
          body={`${columns[dialog.index]?.name ?? "This model"} has unsaved edits. Closing it will discard them.`}
          confirmLabel="Discard and close"
          onCancel={() => setDialog(null)}
          onConfirm={() => { const i = dialog.index; setDialog(null); closeColumn(i); }}
        />
      )}
    </div>
  );
}

function tryEncode(edid: Edid): Uint8Array | null {
  try { return encodeEdid(edid); } catch { return null; }
}

function suggestDuplicateName(fromPath: string): string {
  const base = fromPath.split("/").pop() ?? fromPath;
  const stem = base.replace(/\.ddc$/i, "");
  return stem + "-copy";
}
