import { useState } from "react";

/**
 * A single-field text prompt rendered in the page.
 *
 * Native `window.prompt` blocks the whole tab and is invisible to anything
 * that drives the DOM (including this project's own browser-based test plan),
 * so file creation, renaming and folder creation go through this instead.
 */
export interface PromptDialogProps {
  title: string;
  label: string;
  defaultValue?: string;
  confirmLabel?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog(props: PromptDialogProps) {
  const [value, setValue] = useState(props.defaultValue ?? "");

  const confirm = () => {
    const trimmed = value.trim();
    if (trimmed) props.onConfirm(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <label className="modal-field">
          {props.label}
          <input
            autoFocus
            value={value}
            placeholder={props.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") props.onCancel();
            }}
          />
        </label>
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="primary" onClick={confirm} disabled={!value.trim()}>
            {props.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <p>{props.body}</p>
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="danger" onClick={props.onConfirm}>{props.confirmLabel ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

export interface PickerOption { id: string; label: string; group: string; }

/**
 * Pick one item from a grouped catalogue — used for "which block do I add?".
 *
 * A filter box is included because the CTA catalogue is long enough that
 * scanning it is slower than typing three letters of the block's name.
 */
export function PickerDialog(props: {
  title: string;
  options: PickerOption[];
  onConfirm: (id: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matching = q
    ? props.options.filter((o) => o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
    : props.options;

  const groups: string[] = [];
  for (const o of matching) if (!groups.includes(o.group)) groups.push(o.group);

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <input
          autoFocus
          className="filter"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onCancel();
            if (e.key === "Enter" && matching.length === 1) props.onConfirm(matching[0]!.id);
          }}
        />
        <div className="picker-list">
          {groups.map((group) => (
            <div key={group} className="picker-group">
              <div className="picker-group-name">{group}</div>
              {matching.filter((o) => o.group === group).map((o) => (
                <button key={o.id} className="picker-item" onClick={() => props.onConfirm(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          ))}
          {matching.length === 0 && <p className="dim">Nothing matches “{query}”.</p>}
        </div>
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
