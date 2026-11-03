// The TypeScript layer rule (architecture §11), checked over every import statement of app/src:
//   core → core; platform → core (+ @tauri-apps/* in platform/tauri); services → core, platform/types, services;
//   workers → core; ui → core and React; shell and features → everything except platform/tauri and platform/memory
//   (only main.tsx and demo/ choose a platform). No DOM API in core/ or services/.
// Clarifications this test applies (reported in M0): `import type` of the type-only contract folders
// (services/types, services/context, platform/types) is allowed from ui/ and workers/, whose components and hosts
// take those shapes; tests (*.test.ts) and services/testing/** (test support) may use the memory platform;
// `?raw` imports of repository data files (docs/spec/check-words-v1.txt) are data, not layers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

interface Import { spec: string; typeOnly: boolean }

const IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;

function importsOf(src: string): Import[] {
  const out: Import[] = [];
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[2] ?? m[3];
    if (spec) out.push({ spec, typeOnly: Boolean(m[1]) });
  }
  return out;
}

/** The layer of a src-relative path: core, platform/<x>, services, services/types, services/testing, … */
function layerOf(rel: string): string {
  const p = rel.replace(/\.(ts|tsx)$/, '').split('/');
  const top = p[0] ?? '';
  if (p.length === 1) return top;                                       // App, main, layers.test
  if (top === 'platform') return `platform/${p[1]}`;
  if (top === 'services' && (p[1] === 'types' || p[1] === 'testing' || p[1] === 'context')) return `services/${p[1]}`;
  return top;
}

const TYPE_CONTRACTS = new Set(['services/types', 'services/context', 'platform/types']);

/** May a file of layer `from` import layer `to`? */
function allowed(from: string, to: string, typeOnly: boolean, isTest: boolean): boolean {
  const services = to === 'services' || to === 'services/types' || to === 'services/context';
  // Tests may use the memory platform and the test helpers; core's tests still import only core.
  if (isTest && from !== 'core') return to !== 'platform/tauri' || from === 'platform/tauri' || from === 'platform';
  switch (from) {
    case 'core':
      return to === 'core';
    case 'platform/types':
      return to === 'core' || to === 'platform/types';
    case 'platform/tauri':
    case 'platform/memory':
      return to === 'core' || to === 'platform/types' || to === from;
    case 'services':
    case 'services/types':
    case 'services/context':
      return to === 'core' || to === 'platform/types' || services;
    case 'services/testing':
      return true;
    case 'workers':
      return to === 'core' || to === 'workers' || (typeOnly && TYPE_CONTRACTS.has(to));
    case 'ui':
      return to === 'core' || to === 'ui' || (typeOnly && TYPE_CONTRACTS.has(to));
    case 'shell':
    case 'features':
      return to !== 'platform/tauri' && to !== 'platform/memory';
    default:
      return true; // main.tsx, App.tsx, demo/ choose a platform
  }
}

/** Packages each layer may import (React only from ui/shell/features/App; @tauri-apps only from platform/tauri). */
function packageAllowed(from: string, spec: string): boolean {
  if (spec.startsWith('@tauri-apps/')) return from === 'platform/tauri';
  if (spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec.startsWith('react-dom/') || spec === 'lucide-react') {
    return from === 'ui' || from === 'shell' || from === 'features' || from === 'App' || from === 'main' || from === 'demo';
  }
  return true;
}

const files = walk(SRC).filter((f) => !f.endsWith('layers.test.ts'));

describe('layer rule (architecture §11)', () => {
  it('scans the whole tree', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('rejects the crossings the rule forbids', () => {
    expect(allowed('core', 'services', true, false)).toBe(false);
    expect(allowed('services', 'ui', false, false)).toBe(false);
    expect(allowed('services', 'platform/memory', false, false)).toBe(false);
    expect(allowed('ui', 'services', false, false)).toBe(false);
    expect(allowed('ui', 'services/types', true, false)).toBe(true);
    expect(allowed('features', 'platform/tauri', false, false)).toBe(false);
    expect(allowed('shell', 'platform/memory', true, false)).toBe(false);
    expect(allowed('workers', 'services', false, false)).toBe(false);
    expect(packageAllowed('services', 'react')).toBe(false);
    expect(packageAllowed('platform/memory', '@tauri-apps/api/core')).toBe(false);
    expect(layerOf('services/context.ts')).toBe('services/context');
    expect(importsOf("import type { A } from '../x';\nimport { B } from './y';\nconst m = import('../z');")).toEqual([
      { spec: '../x', typeOnly: true }, { spec: './y', typeOnly: false }, { spec: '../z', typeOnly: false },
    ]);
  });

  it('every import respects the layer rule', () => {
    const bad: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).split(sep).join('/');
      const from = layerOf(rel);
      const isTest = /\.test\.tsx?$/.test(rel) || rel.endsWith('.testutil.ts');
      for (const imp of importsOf(readFileSync(file, 'utf8'))) {
        if (imp.spec.endsWith('?raw') || imp.spec.endsWith('?url') || imp.spec.endsWith('.css')) continue;
        if (!imp.spec.startsWith('.')) {
          if (!packageAllowed(from, imp.spec)) bad.push(`${rel}: ${imp.spec}`);
          continue;
        }
        const target = normalize(join(dirname(rel), imp.spec)).split(sep).join('/');
        if (target.startsWith('..')) {
          bad.push(`${rel}: ${imp.spec} (outside src)`);
          continue;
        }
        const to = layerOf(target);
        if (!allowed(from, to, imp.typeOnly, isTest)) bad.push(`${rel}: ${imp.typeOnly ? 'type ' : ''}${imp.spec} (${from} → ${to})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('core/ and services/ use no DOM API (they run under Node)', () => {
    const bad: string[] = [];
    const DOM = /\b(document|window|localStorage|sessionStorage|navigator)\s*\.|\bnew\s+(Worker|Image|FileReader)\b/;
    for (const file of files) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (!/^(core|services)\//.test(rel) || /\.test\.ts$/.test(rel)) continue;
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      const m = DOM.exec(code);
      if (m) bad.push(`${rel}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
