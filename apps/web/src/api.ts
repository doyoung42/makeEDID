import type { Edid, SpecField } from "@edid/core";

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface DirNode {
  name: string;
  path: string;
  dirs: DirNode[];
  files: FileEntry[];
}

export interface BlockInfo {
  index: number;
  hex: string;
  checksumValid: boolean;
}

export interface EdidDoc {
  path: string;
  name: string;
  hex: string;
  blocks: BlockInfo[];
  fields: SpecField[];
  edid: Edid;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const send = (method: string, url: string, payload: unknown) =>
  request<EdidDoc>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const api = {
  project: () => request<{ dir: string; exists: boolean }>("/api/project"),

  setProject: (dir: string) =>
    request<{ dir: string }>("/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir }),
    }),

  tree: () => request<{ dir: string; tree: DirNode; files: FileEntry[] }>("/api/tree"),

  load: (path: string) => request<EdidDoc>(`/api/edid?path=${encodeURIComponent(path)}`),

  save: (path: string, hex: string) => send("PUT", "/api/edid", { path, hex }),

  create: (path: string, productName?: string) =>
    send("POST", "/api/file", { path, productName }),

  /** `base64` is the raw source file; the server converts it to .ddc. */
  import: (path: string, sourceName: string, base64: string, overwrite = false) =>
    send("POST", "/api/import", { path, sourceName, base64, overwrite }),

  duplicate: (from: string, to: string) => send("POST", "/api/duplicate", { from, to }),

  makeDir: (path: string) =>
    request<{ path: string }>("/api/dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  remove: (path: string) =>
    request<{ path: string; deleted: boolean }>(`/api/edid?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
};

/** Read a picked file as base64 without pulling in a multipart upload path. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      // readAsDataURL gives "data:<mime>;base64,<payload>".
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
