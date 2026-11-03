// Inline marks in catalog strings (UX §5 conventions): `[b]…[/b]` for bold and `[m]…[/m]` for the
// highlighter emphasis (.hl-emph), inside one translatable sentence. Marks do not nest; anything
// malformed stays plain text.
import React from 'react';

export interface MarkPiece {
  text: string;
  mark: 'b' | 'm' | null;
}

const MARK = /\[([bm])\]([\s\S]*?)\[\/\1\]/g;

export function parseMarks(s: string): MarkPiece[] {
  const out: MarkPiece[] = [];
  let at = 0;
  for (const m of s.matchAll(MARK)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: s.slice(at, i), mark: null });
    if (m[2]) out.push({ text: m[2], mark: m[1] as 'b' | 'm' });
    at = i + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at), mark: null });
  return out;
}

/** The text without its marks (for aria-labels, titles and notifications). */
export function stripMarks(s: string): string {
  return parseMarks(s).map((p) => p.text).join('');
}

export function renderMarks(s: string): React.ReactNode {
  return parseMarks(s).map((p, i) =>
    p.mark === 'b' ? <strong key={i}>{p.text}</strong> : p.mark === 'm' ? <span key={i} className="hl-emph">{p.text}</span> : <React.Fragment key={i}>{p.text}</React.Fragment>,
  );
}

export function Marked({ text }: { text: string }) {
  return <>{renderMarks(text)}</>;
}
