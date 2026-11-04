// "Save as a file…" for small text files (the `.tramado-invite` file, sync spec §7.2; the diagnostics log). The
// platform has no "write text to a picked path" command, so the page hands the browser a Blob with a file name: the
// browser demo saves it to Downloads; the desktop webview does the same (contract change requested at G2 for a native
// save dialog).
export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
