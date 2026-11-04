// Line-level diff for the note conflict dialog (UX §3.8 ConflictDialog, sync spec §16.3): Myers'
// O((N+M)·D) algorithm over lines, returning the edit script as runs of equal / removed / added
// lines. Pure and deterministic; a side-by-side view pairs `del` and `add` runs.

export type DiffOp = 'equal' | 'del' | 'add';
export interface DiffRun { op: DiffOp; lines: string[] }

/** Splits a note into lines (a final "\n" does not make an empty last line). */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Myers' shortest edit script between two line arrays, as runs (deletions before additions). */
export function diffLines(a: readonly string[], b: readonly string[]): DiffRun[] {
  // Trim the common head and tail: most conflicts change a few lines in a long note.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);
  const n = A.length;
  const m = B.length;
  const max = n + m;
  const ops: DiffOp[] = [];
  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) ops.push('del');
    for (let j = 0; j < m; j++) ops.push('add');
  } else {
    const off = max;
    let v: Int32Array = new Int32Array(2 * max + 2);
    const trace: Int32Array[] = [];
    let done = false;
    for (let d = 0; d <= max && !done; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= n && y >= m) {
          done = true;
          break;
        }
      }
    }
    trace.push(v.slice());
    // Walk back through the trace.
    let x = n;
    let y = m;
    const rev: DiffOp[] = [];
    for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
      v = trace[d]!;
      const k = x - y;
      const prevK = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? k + 1 : k - 1;
      const prevX = v[off + prevK]!;
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        rev.push('equal');
        x--;
        y--;
      }
      if (d === 0) break;
      if (x === prevX) {
        rev.push('add');
        y--;
      } else {
        rev.push('del');
        x--;
      }
    }
    while (x > 0 && y > 0) {
      rev.push('equal');
      x--;
      y--;
    }
    ops.push(...rev.reverse());
  }
  const runs: DiffRun[] = [];
  const push = (op: DiffOp, line: string) => {
    const last = runs[runs.length - 1];
    if (last && last.op === op) last.lines.push(line);
    else runs.push({ op, lines: [line] });
  };
  for (let i = 0; i < head; i++) push('equal', a[i]!);
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === 'equal') {
      push('equal', A[i++]!);
      j++;
    } else if (op === 'del') push('del', A[i++]!);
    else push('add', B[j++]!);
  }
  for (let t = a.length - tail; t < a.length; t++) push('equal', a[t]!);
  // Within a changed block, show what was removed before what was added.
  for (let r = 0; r + 1 < runs.length; r++) {
    if (runs[r]!.op === 'add' && runs[r + 1]!.op === 'del') [runs[r], runs[r + 1]] = [runs[r + 1]!, runs[r]!];
  }
  return runs;
}

/** Applies a diff's "a" side or "b" side back (tests, and a sanity check of a script). */
export function sideOf(runs: readonly DiffRun[], side: 'a' | 'b'): string[] {
  return runs.filter((r) => r.op === 'equal' || r.op === (side === 'a' ? 'del' : 'add')).flatMap((r) => r.lines);
}

/** Rows for a side-by-side view: changed blocks pair their removed and added lines. */
export interface SideRow { left: string | null; right: string | null; op: DiffOp | 'change' }
export function sideBySide(runs: readonly DiffRun[]): SideRow[] {
  const rows: SideRow[] = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!;
    if (run.op === 'equal') {
      for (const l of run.lines) rows.push({ left: l, right: l, op: 'equal' });
      continue;
    }
    const next = runs[r + 1];
    if (run.op === 'del' && next?.op === 'add') {
      const n = Math.max(run.lines.length, next.lines.length);
      for (let i = 0; i < n; i++) rows.push({ left: run.lines[i] ?? null, right: next.lines[i] ?? null, op: 'change' });
      r++;
      continue;
    }
    for (const l of run.lines) rows.push(run.op === 'del' ? { left: l, right: null, op: 'del' } : { left: null, right: l, op: 'add' });
  }
  return rows;
}
