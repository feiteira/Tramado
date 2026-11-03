import { describe, expect, it } from 'vitest';
import { catalogs } from './catalogs';
import { UI_LOCALES } from './languages';

type Tree = { [k: string]: string | Tree };

function leaves(t: Tree, prefix = ''): [string, string][] {
  return Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

// Namespaces still a copy of English export `pending = true` (architecture §14). Their
// "identical to English" check is skipped until the owner translates them; keys and
// placeholders are still checked. With TRAMADO_RELEASE=1 any pending namespace fails.
const modules = import.meta.glob<{ pending?: boolean }>('./locales/*/*.ts', { eager: true });
function pendingOf(locale: string): Set<string> {
  const out = new Set<string>();
  for (const [path, mod] of Object.entries(modules)) {
    const m = /\.\/locales\/(\w+)\/(\w+)\.ts$/.exec(path);
    if (m && m[1] === locale && m[2] !== 'index' && mod.pending === true) out.add(m[2]!);
  }
  return out;
}

const en = new Map(leaves(catalogs.en as unknown as Tree));
// Strings that are legitimately identical across languages (names, format codes).
const SAME_OK = /^(common\.appName|common\.ok|common\.size\..*|common\.duration\..*|errors\.withReason|a11y\.screenChanged|a11y\.progress)$/;

describe.each(UI_LOCALES.filter((l) => l !== 'en'))('%s catalog', (locale) => {
  const other = new Map(leaves(catalogs[locale] as unknown as Tree));
  const pending = pendingOf(locale);
  const translated = (k: string) => !pending.has(k.split('.')[0]!);

  it('is a real translation, not a copy of English', () => {
    const keys = [...en].filter(([k]) => translated(k));
    const same = keys.filter(([k, v]) => other.get(k) === v && v.length > 3 && !SAME_OK.test(k));
    expect(same.map(([k]) => k)).toEqual(same.length / Math.max(1, keys.length) < 0.05 ? same.map(([k]) => k) : []);
  });

  it('keeps every {placeholder}', () => {
    for (const [k, v] of en) {
      // A singular form may say "its document" instead of "its 1 document".
      const drop = (ph: string[]) => (k.endsWith('.one') ? ph.filter((p) => p !== '{n}') : ph);
      const want = [...new Set(drop(v.match(/\{\w+\}/g) ?? []))].sort().join(',');
      const got = [...new Set(drop(other.get(k)?.match(/\{\w+\}/g) ?? []))].sort().join(',');
      expect(got, k).toBe(want);
    }
  });

  it('has nothing pending in a release build', () => {
    if (process.env.TRAMADO_RELEASE === '1') expect([...pending]).toEqual([]);
    else expect(pending.has('common') || pending.has('errors') || pending.has('a11y') || pending.has('notify')).toBe(false);
  });
});
