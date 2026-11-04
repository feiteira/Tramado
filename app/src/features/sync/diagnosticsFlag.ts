// "Diagnostics" in the sync popover opens Settings › Sharing with the diagnostics expanded (UX §2.4): the popover
// calls requestDiagnostics() before navigating; the Sharing section takes the request once when it mounts.
let requested = false;

export function requestDiagnostics(): void {
  requested = true;
}

export function takeDiagnosticsRequest(): boolean {
  const r = requested;
  requested = false;
  return r;
}
