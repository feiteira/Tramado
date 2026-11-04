// Settings › Privacy › "AI activity on this computer" (UX §3.14.8): each log entry is one request; consecutive
// entries of the same action and class within 60 s become one row whose "Requests" is their count.

export interface ActivityEntry {
  at: string; model: string | null; classId: string | null; action: string | null; passages: number; code: string | null;
}

export interface ActivityRow {
  /** The newest request's time (the log is newest first). */
  at: string;
  classId: string | null;
  action: string | null;
  models: string[];
  passages: number;
  requests: number;
  /** Error codes seen in the group (e.g. a busy model before the fallback answered). */
  codes: string[];
}

export const GROUP_WINDOW_MS = 60_000;

/** Groups the log (newest first, as `ai_activity` returns it) into rows, newest first. */
export function groupActivity(entries: readonly ActivityEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let last: { row: ActivityRow; atMs: number } | null = null;
  for (const e of entries) {
    const atMs = Date.parse(e.at);
    if (last && last.row.action === e.action && last.row.classId === e.classId && Number.isFinite(atMs) && Math.abs(last.atMs - atMs) <= GROUP_WINDOW_MS) {
      const r = last.row;
      r.requests += 1;
      r.passages = Math.max(r.passages, e.passages);
      if (e.model && !r.models.includes(e.model)) r.models.push(e.model);
      if (e.code && !r.codes.includes(e.code)) r.codes.push(e.code);
      last.atMs = atMs;
      continue;
    }
    const row: ActivityRow = { at: e.at, classId: e.classId, action: e.action, models: e.model ? [e.model] : [], passages: e.passages, requests: 1, codes: e.code ? [e.code] : [] };
    rows.push(row);
    last = { row, atMs };
  }
  return rows;
}
