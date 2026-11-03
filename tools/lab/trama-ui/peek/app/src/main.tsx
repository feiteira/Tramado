import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Scale, Mic, Sparkles } from 'lucide-react';
import '@fontsource-variable/figtree/wght.css';
import './tokens.css';

// A stand-in for Tramado's demo boot: URL parameters pick the theme and the screen.
const q = new URLSearchParams(location.search);
const theme = q.get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => void setTimeout(() => setReady(true), 300), []);
  if (!ready) return <p aria-busy="true">Loading…</p>;
  return (
    <main data-testid={`screen-${q.get('route') ?? 'classes'}`} style={{ padding: 24, fontFamily: 'var(--font-ui)', color: 'var(--ink)' }}>
      <h1 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Scale aria-hidden /> Constitutional Law I</h1>
      <p style={{ color: 'var(--ink-3)' }}>Prof. Marta Reis</p>
      <button data-testid="record" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 0, borderRadius: 9, height: 34, padding: '0 14px', display: 'inline-flex', gap: 8, alignItems: 'center' }}><Mic size={16} aria-hidden /> Record class</button>
      <p style={{ marginTop: 16, background: 'var(--ai-soft)', color: 'var(--ai-text)', padding: 8, borderRadius: 9 }}><Sparkles size={14} aria-hidden /> AI draft</p>
      <button data-testid="ok" aria-label="Record" style={{ width: 24, height: 24 }}><Mic size={12} aria-hidden /></button>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
