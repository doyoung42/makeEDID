import { useState } from "react";
import type { DirNode, FileEntry } from "./api";

/**
 * Model-unit folder browser.
 *
 * Captures are organised by model, then by port and mode, and the nesting depth
 * varies from two to seven levels depending on how thoroughly a model was
 * captured — so this is a real tree, not a fixed-depth listing. Folders with no
 * .ddc in them are still shown: they carry the model's structure.
 */

export interface FileTreeProps {
  tree: DirNode | null;
  loaded: Set<string>;
  onToggle: (file: FileEntry) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onImport: (dir: string) => void;
  onDuplicate: (path: string) => void;
  onDelete: (path: string) => void;
  onDrop: (dir: string, files: FileList) => void;
}

export function FileTree(props: FileTreeProps) {
  if (!props.tree) return <p className="hint">Loading…</p>;

  const total = countFiles(props.tree);
  return (
    <div className="tree">
      <Folder node={props.tree} depth={0} root {...props} />
      {total === 0 && (
        <p className="hint">
          No <code>.ddc</code> files yet. Use <strong>New</strong> to start one, or drop a
          <code>.ddc</code> / <code>.xml</code> / <code>.bin</code> here to import it.
        </p>
      )}
    </div>
  );
}

function countFiles(node: DirNode): number {
  return node.files.length + node.dirs.reduce((n, d) => n + countFiles(d), 0);
}

function Folder(props: FileTreeProps & { node: DirNode; depth: number; root?: boolean }) {
  const { node, depth, root, loaded, onToggle } = props;
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const label = root ? "Project" : node.name;
  const indent = { paddingLeft: depth * 12 + 4 };

  return (
    <div
      className={`folder${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (e.dataTransfer.files.length) props.onDrop(node.path, e.dataTransfer.files);
      }}
    >
      <div className="folder-row" style={indent}>
        <button
          className="twisty"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="folder-name" title={node.path || "project root"}>{label}</span>
        <span className="folder-actions">
          <button title="New .ddc in this folder" onClick={() => props.onNewFile(node.path)}>+file</button>
          <button title="New subfolder" onClick={() => props.onNewFolder(node.path)}>+dir</button>
          <button title="Import a .ddc / .xml / .bin here" onClick={() => props.onImport(node.path)}>import</button>
        </span>
      </div>

      {open && (
        <>
          {node.dirs.map((d) => (
            <Folder key={d.path} {...props} node={d} depth={depth + 1} root={false} />
          ))}
          {node.files.map((f) => (
            <div
              key={f.path}
              className={`file-row${loaded.has(f.path) ? " loaded" : ""}`}
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <label title={f.path}>
                <input
                  type="checkbox"
                  checked={loaded.has(f.path)}
                  onChange={() => onToggle(f)}
                />
                <span className="file-name">{f.name}</span>
              </label>
              <span className="file-actions">
                <button title="Duplicate as a new model" onClick={() => props.onDuplicate(f.path)}>copy</button>
                <button title="Delete" onClick={() => props.onDelete(f.path)}>del</button>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
