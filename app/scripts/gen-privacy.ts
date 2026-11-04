// Writes PRIVACY.md (English), PRIVACY.pt.md and PRIVACY.es.md at the repository root from the single list of ways
// data leaves the computer (app/src/core/privacy/flows.ts) and the `privacy` catalog (UX §3.14.8, Trama's pattern).
// With --check it writes nothing and fails when a file is out of date (CI).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_LOCALES } from '../src/core/i18n/languages';
import { privacyFile, privacyMarkdown } from '../src/core/privacy/flows';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
let stale = 0;
for (const locale of UI_LOCALES) {
  const out = resolve(root, privacyFile(locale));
  const md = privacyMarkdown(locale);
  if (check) {
    let current = '';
    try {
      current = readFileSync(out, 'utf8');
    } catch {
      // Missing counts as out of date.
    }
    if (current !== md) {
      console.error(`${privacyFile(locale)} is out of date. Run: npm run gen:privacy`);
      stale += 1;
    }
  } else {
    writeFileSync(out, md);
    console.log(`Wrote ${out}`);
  }
}
if (check) {
  if (stale) process.exit(1);
  console.log('PRIVACY.md, PRIVACY.pt.md and PRIVACY.es.md are up to date.');
}
