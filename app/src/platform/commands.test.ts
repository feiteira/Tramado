import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// The IPC contract check of architecture §17: every command the TS bindings call exists in Rust's
// generate_handler! list (desktop/src-tauri/src/lib.rs), and both equal the command tables of §6.

const root = new URL('../../../', import.meta.url);
const tauriDir = new URL('app/src/platform/tauri/', root);

function tsCommands(): string[] {
  const names = new Set<string>();
  for (const f of readdirSync(tauriDir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    const src = readFileSync(new URL(f, tauriDir), 'utf8');
    for (const m of src.matchAll(/\bcall(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*'([a-z0-9_]+)'/g)) names.add(m[1]!);
  }
  return [...names].sort();
}

function archCommands(): string[] {
  const arch = readFileSync(new URL('docs/dev/architecture.md', root), 'utf8');
  const s = arch.indexOf('## 6. IPC contract');
  const e = arch.indexOf('## 7. Events and channels');
  const names = new Set<string>();
  for (const line of arch.slice(s, e).split('\n')) {
    const m = /^\| `([a-z0-9_]+)` \|/.exec(line);
    if (m) names.add(m[1]!);
  }
  return [...names].sort();
}

function rustCommands(): string[] | null {
  const lib = new URL('desktop/src-tauri/src/lib.rs', root);
  if (!existsSync(lib)) return null;
  const src = readFileSync(lib, 'utf8');
  const i = src.indexOf('generate_handler![');
  if (i < 0) return null;
  const end = src.indexOf(']', i);
  const body = src.slice(i + 'generate_handler!['.length, end).replace(/\/\/[^\n]*/g, '');
  return body
    .split(',')
    .map((s) => s.trim().split('::').pop()!.trim())
    .filter((s) => /^[a-z0-9_]+$/.test(s))
    .sort();
}

describe('IPC command names', () => {
  it('the TS bindings call exactly the commands of architecture §6', () => {
    expect(tsCommands()).toEqual(archCommands());
  });

  const rust = rustCommands();
  it.skipIf(rust === null)('match the generate_handler! list of desktop/src-tauri/src/lib.rs', () => {
    expect(rust).toEqual(tsCommands());
  });
});
