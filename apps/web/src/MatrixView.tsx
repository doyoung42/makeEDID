import { Fragment, useMemo, useState } from "react";
import type { SpecField, ByteSpan } from "@edid/core";
import {
  isFieldEditable, buildFieldTree, flattenTree,
  describeInput, describeCount, readOnlyReason, type FieldInput,
} from "@edid/core";
import type { Column } from "./App";

/**
 * Rows are spec fields, columns are models.
 *
 * Rows form the physical hierarchy — block → sub-block → field — because that
 * is how an EDID is actually laid out and how its checksums are scoped. The
 * `group` string is kept as a separate, semantic axis and drives the filter, so
 * "Timings" still finds base-block and CTA DTDs together even though the tree
 * puts them in different blocks.
 */

export interface MatrixViewProps {
  columns: Column[];
  /** flattenEdid output per column, index-aligned with `columns`. */
  fieldsByColumn: SpecField[][];
  baseline: number;
  setBaseline: (i: number) => void;
  focused: number;
  setFocused: (i: number) => void;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onEdit: (colIndex: number, path: string, value: string | number | boolean) => void;
  onCopyColumn: (i: number) => void;
  onPaste: (targets: number[]) => void;
  onPropagateRow: (path: string) => void;
  onSave: (i: number) => void;
  onRevert: (i: number) => void;
  onClose: (i: number) => void;
  hasClipboard: boolean;
  /**
   * Structural editing. These act on the *focused* column — the one the byte
   * view is showing — because a block exists in one model at a time, unlike a
   * field value which every column carries.
   */
  structure: {
    canAdd: (col: number, path: string) => boolean;
    canRemove: (col: number, path: string) => boolean;
    onAdd: (col: number, path: string) => void;
    onRemove: (col: number, path: string) => void;
    onSetCount: (col: number, path: string, n: number) => void;
    onAddExtension: (col: number) => void;
  };
}

interface Row {
  path: string;
  group: string;
  label: string;
  kind: SpecField["kind"];
  role: SpecField["role"];
  depth: number;
  editable: boolean;
  hasChildren: boolean;
  childCount: number;
  values: (SpecField["value"] | undefined)[];
  spans: (ByteSpan | null)[];
  /** How this row is typed into, and whether it is a resizable list. */
  input: FieldInput | null;
  count: FieldInput | null;
}

export function MatrixView(props: MatrixViewProps) {
  const {
    columns, fieldsByColumn, baseline, selectedPath, onSelectPath, onEdit,
  } = props;

  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Until the user touches a twisty, the tree folds itself (see defaultCollapsed). */
  const [autoCollapse, setAutoCollapse] = useState(true);

  const rows = useMemo<Row[]>(() => {
    const perColumn = fieldsByColumn.map((fs) => new Map(fs.map((f) => [f.path, f])));

    // Union of paths: the baseline's order first, then anything only other
    // models carry, so a column with an extra block still shows it.
    const order: string[] = [];
    const seen = new Set<string>();
    const push = (p: string) => { if (!seen.has(p)) { seen.add(p); order.push(p); } };
    (fieldsByColumn[baseline] ?? []).forEach((f) => push(f.path));
    fieldsByColumn.forEach((fs) => fs.forEach((f) => push(f.path)));

    // Representative rows carry structure; spans stay per-column because the
    // same field sits at different offsets in different models.
    const representative: SpecField[] = [];
    for (const path of order) {
      const rep = perColumn.find((m) => m.has(path))?.get(path);
      if (rep) representative.push(rep);
    }

    const nodes = flattenTree(buildFieldTree(representative));
    return nodes.map((n) => ({
      path: n.field.path,
      group: n.field.group,
      label: n.field.label,
      kind: n.field.kind,
      role: n.field.role,
      depth: n.depth,
      editable: isFieldEditable(n.field.path),
      hasChildren: n.children.length > 0,
      childCount: n.children.length,
      values: perColumn.map((m) => m.get(n.field.path)?.value),
      spans: perColumn.map((m) => m.get(n.field.path)?.span ?? null),
      input: describeInput(n.field.path, n.field.kind),
      count: describeCount(n.field.path),
    }));
  }, [fieldsByColumn, baseline]);

  /**
   * A fully expanded EDID is ~244 rows and can reach 474, so the tree starts
   * folded wherever a group would flood the view. The threshold is adaptive
   * rather than a hardcoded path list: small groups like the CTA header (6
   * flags) stay open, while a VSDB or the 17 established timings fold away.
   */
  const defaultCollapsed = useMemo(
    () => new Set(rows.filter((r) => r.childCount > 6).map((r) => r.path)),
    [rows],
  );

  const effectiveCollapsed = autoCollapse ? defaultCollapsed : collapsed;

  /** Rows hidden because an ancestor is collapsed. */
  const hiddenByCollapse = useMemo(() => {
    const hidden = new Set<string>();
    if (effectiveCollapsed.size === 0) return hidden;
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const parentOf = new Map<string, string | null>();
    for (const f of fieldsByColumn.flat()) if (!parentOf.has(f.path)) parentOf.set(f.path, f.parent);

    for (const r of rows) {
      let p = parentOf.get(r.path) ?? null;
      const guard = new Set<string>();
      while (p && !guard.has(p)) {
        guard.add(p);
        if (effectiveCollapsed.has(p)) { hidden.add(r.path); break; }
        p = parentOf.get(p) ?? null;
      }
      void byPath;
    }
    return hidden;
  }, [rows, effectiveCollapsed, fieldsByColumn]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // A search looks through the whole tree. Folding is a browsing aid, not a
      // filter — with groups collapsed by default, honouring it here would make
      // the search box find almost nothing.
      if (!q && hiddenByCollapse.has(r.path)) return false;
      if (q && !r.label.toLowerCase().includes(q) && !r.group.toLowerCase().includes(q)
        && !r.path.toLowerCase().includes(q)) return false;
      if (!onlyDiffs) return true;
      if (r.role !== "field") return true;   // keep the structure around diffs
      const ref = r.values[baseline];
      return r.values.some((v, i) => i !== baseline && !sameValue(v, ref));
    });
  }, [rows, search, onlyDiffs, baseline, hiddenByCollapse]);

  const toggleSelected = (i: number) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const toggleCollapsed = (path: string) => {
    // The first manual toggle takes ownership of the whole collapse state.
    const base = autoCollapse ? defaultCollapsed : collapsed;
    const next = new Set(base);
    next.has(path) ? next.delete(path) : next.add(path);
    setAutoCollapse(false);
    setCollapsed(next);
  };

  const focusedName = columns[props.focused]?.name ?? "this model";

  const pasteTargets = selected.size > 0
    ? [...selected]
    : columns.map((_, i) => i).filter((i) => i !== baseline);

  return (
    <>
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} />
          Only differences
        </label>
        <input
          className="filter"
          placeholder="Filter fields…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="dim">
          {visible.length} of {rows.length} rows · baseline: <strong>{columns[baseline]?.name ?? "—"}</strong>
        </span>

        <span className="spacer" />

        <button
          onClick={() => props.structure.onAddExtension(props.focused)}
          title={"Add a CTA-861 or DisplayID extension block to " + focusedName}
        >
          Add extension…
        </button>
        <button onClick={() => {
          setAutoCollapse(false);
          setCollapsed(new Set(rows.filter((r) => r.hasChildren).map((r) => r.path)));
        }}>
          Collapse all
        </button>
        <button onClick={() => { setAutoCollapse(false); setCollapsed(new Set()); }}>Expand all</button>
        <button onClick={() => props.onCopyColumn(baseline)}>Copy baseline spec</button>
        <button
          disabled={!props.hasClipboard || pasteTargets.length === 0}
          onClick={() => props.onPaste(pasteTargets)}
          title={selected.size > 0 ? `Paste into ${selected.size} selected column(s)` : "Paste into all non-baseline columns"}
        >
          Paste into {selected.size > 0 ? `${selected.size} selected` : "all others"}
        </button>
      </div>

      <div className="scroll">
        {/*
          * Columns always share the available width. A manual mode existed here
          * but could not work: `table.matrix` is `width: 100%` with
          * `table-layout: fixed`, so the browser rescales any explicit column
          * width back to fill the table.
          */}
        <table className="matrix fit">
          <colgroup>
            <col className="field-col-group" />
            {columns.map((c) => <col key={c.path} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="field-col">Spec field</th>
              {columns.map((c, i) => (
                <th key={c.path} className={i === props.focused ? "focused" : undefined}>
                  <div className="col-head">
                    <button
                      className="name"
                      title={`${c.path}\nClick to show this model in the byte view`}
                      onClick={() => props.setFocused(i)}
                    >
                      {c.name}
                    </button>
                    <div className="badges">
                      {i === baseline && <span className="badge">baseline</span>}
                      {c.dirty && <span className="badge dirty">unsaved</span>}
                    </div>
                    <div className="actions">
                      <input
                        type="checkbox"
                        title="Select as a paste target"
                        checked={selected.has(i)}
                        onChange={() => toggleSelected(i)}
                      />
                      <button onClick={() => props.setBaseline(i)} disabled={i === baseline} title="Use as baseline">Base</button>
                      <button onClick={() => props.onSave(i)} disabled={!c.dirty} title="Save this model">Save</button>
                      <button onClick={() => props.onRevert(i)} disabled={!c.dirty} title="Discard changes">Revert</button>
                      <button onClick={() => props.onClose(i)} title="Close this column">×</button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const ref = row.values[baseline];
              const isSelected = row.path === selectedPath;
              return (
                <Fragment key={row.path}>
                  <tr className={`role-${row.role}${isSelected ? " row-selected" : ""}`}>
                    <td
                      className="field-col"
                      title={row.path}
                      style={{ paddingLeft: 6 + row.depth * 14 }}
                      onClick={() => onSelectPath(isSelected ? null : row.path)}
                    >
                      {row.hasChildren ? (
                        <button
                          className="twisty"
                          onClick={(e) => { e.stopPropagation(); toggleCollapsed(row.path); }}
                          aria-expanded={!effectiveCollapsed.has(row.path)}
                        >
                          {effectiveCollapsed.has(row.path) ? "+" : "−"}
                        </button>
                      ) : <span className="twisty-spacer" />}
                      <span className="row-label">{row.label}</span>
                      {props.structure.canAdd(props.focused, row.path) && (
                        <button
                          className="struct add"
                          title={"Add a data block to this extension in " + focusedName}
                          onClick={(e) => { e.stopPropagation(); props.structure.onAdd(props.focused, row.path); }}
                        >
                          ＋
                        </button>
                      )}
                      {props.structure.canRemove(props.focused, row.path) && (
                        <button
                          className="struct remove"
                          title={"Remove this block from " + focusedName}
                          onClick={(e) => { e.stopPropagation(); props.structure.onRemove(props.focused, row.path); }}
                        >
                          ✕
                        </button>
                      )}
                      {row.editable && columns.length > 1 && (
                        <button
                          className="propagate"
                          title="Copy the baseline value into every other column"
                          onClick={(e) => { e.stopPropagation(); props.onPropagateRow(row.path); }}
                        >
                          →
                        </button>
                      )}
                    </td>
                    {columns.map((_, i) => (
                      <Cell
                        key={i}
                        path={row.path}
                        value={row.values[i]}
                        differs={i !== baseline && row.role === "field" && !sameValue(row.values[i], ref)}
                        isBaseline={i === baseline}
                        editable={row.editable}
                        kind={row.kind}
                        input={row.input}
                        count={row.count}
                        onCommit={(v) => onEdit(i, row.path, v)}
                        onSetCount={(n) => props.structure.onSetCount(i, row.path, n)}
                        onSelect={() => onSelectPath(row.path)}
                      />
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Cell(props: {
  path: string;
  value: SpecField["value"] | undefined;
  differs: boolean;
  isBaseline: boolean;
  editable: boolean;
  kind: SpecField["kind"];
  input: FieldInput | null;
  count: FieldInput | null;
  onCommit: (value: string | number | boolean) => void;
  onSetCount: (n: number) => void;
  onSelect: () => void;
}) {
  const { path, value, differs, isBaseline, editable, input, count, onCommit, onSetCount, onSelect } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const className = [
    "cell",
    differs ? "diff" : "",
    isBaseline ? "baseline-col" : "",
    editable ? "editable" : "readonly",
  ].filter(Boolean).join(" ");

  if (value === undefined) return <td className="cell readonly absent">—</td>;

  // A group row whose list can be resized gets a stepper instead of a value.
  if (count && count.control === "count") {
    const n = countOf(value);
    return (
      <td className={className + " count-cell"} onClick={onSelect}>
        <button
          className="step"
          disabled={n <= count.min}
          title={"Remove the last " + count.itemLabel}
          onClick={(e) => { e.stopPropagation(); onSetCount(n - 1); }}
        >−</button>
        <span className="count-value">{n}</span>
        <button
          className="step"
          disabled={n >= count.max}
          title={"Add another " + count.itemLabel}
          onClick={(e) => { e.stopPropagation(); onSetCount(n + 1); }}
        >+</button>
      </td>
    );
  }

  // Read-only cells say *why*. "Derived from the fields below" is information;
  // a greyed-out box with no explanation reads as a missing feature.
  if (!editable) {
    const why = readOnlyReason(path);
    const text = value === null ? "—" : String(value);
    return (
      <td className={className} title={why ? text + "\n\nRead-only — " + why : text} onClick={onSelect}>
        {text}
      </td>
    );
  }

  if (input?.control === "boolean") {
    return (
      <td className={className} onClick={onSelect}>
        <input type="checkbox" checked={value === true} onChange={(e) => onCommit(e.target.checked)} />
      </td>
    );
  }

  // A dropdown shows "code — label" but always commits the raw code. The codec
  // stores codes, and round-trip tests have broken twice when a label leaked in.
  if (input?.control === "select") {
    const current = Number(value);
    const known = input.options.some((o) => o.value === current);
    return (
      <td className={className} onClick={onSelect}>
        <select value={String(current)} onChange={(e) => onCommit(Number(e.target.value))} title={path}>
          {!known && <option value={String(current)}>{current} — (not in spec)</option>}
          {input.options.map((o) => (
            <option key={o.value} value={String(o.value)}>{o.value} — {o.label}</option>
          ))}
        </select>
      </td>
    );
  }

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft !== String(value)) onCommit(draft);
    };
    const range = input?.control === "number" || input?.control === "coded" ? input : null;
    const outOfRange = range !== null && range.min !== undefined && range.max !== undefined
      && draft.trim() !== "" && (Number(draft) < range.min || Number(draft) > range.max);
    return (
      <td className={className}>
        <input
          autoFocus
          className={(outOfRange ? "out-of-range " : "") + (input?.control === "hex" ? "mono" : "")}
          onFocus={(e) => e.target.select()}
          value={draft}
          placeholder={hintFor(input)}
          title={hintFor(input)}
          maxLength={input?.control === "text" ? input.maxLength : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </td>
    );
  }

  const text = value === null ? "—" : String(value);
  const hint = hintFor(input);
  return (
    <td
      className={className}
      title={hint ? text + "\n" + hint : text}
      // One click, not two. With 368 editable fields a hidden double-click was
      // indistinguishable from the field simply not being editable.
      onClick={() => { onSelect(); setDraft(String(value ?? "")); setEditing(true); }}
    >
      {text}
    </td>
  );
}

function countOf(value: SpecField["value"] | undefined): number {
  const n = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

/** The placeholder and tooltip that say what a field will accept. */
function hintFor(input: FieldInput | null): string {
  if (!input) return "";
  switch (input.control) {
    case "number":
      if (input.min === undefined || input.max === undefined) return input.unit ?? "";
      return input.min + "–" + input.max + (input.unit ? " " + input.unit : "");
    case "coded":
      return "code " + input.min + "–" + input.max + " → " + input.unit;
    case "text": return "up to " + input.maxLength + " characters";
    case "hex": return input.bytes === null ? "hex bytes" : input.bytes + " byte(s), hex";
    case "list": return "e.g. " + input.example;
    default: return "";
  }
}

function sameValue(a: SpecField["value"] | undefined, b: SpecField["value"] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return String(a) === String(b);
}
