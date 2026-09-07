/**
 * Trigger a client-side file download. This is an ordinary tab in the user's
 * own browser (Chrome/Edge/Firefox, wherever `npm start` is opened) — not a
 * sandboxed preview — so a transient `<a download>` works exactly like it
 * would on any other site.
 */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Swap (or add) a filename's extension, so "MODEL.ddc" export-as-xml becomes "MODEL.xml". */
export function withExtension(name: string, ext: string): string {
  const stem = name.replace(/\.(ddc|xml|bin|txt)$/i, "");
  return `${stem}.${ext}`;
}
