// peek: one screenshot of the browser demo, for agents and people checking a screen headlessly (plan §2.3
// item 10). Prints JSON { png, errors, console, overflow, axe } and exits 1 on page errors, a Vite overlay, a
// missing `ready` id, a failed step or assertion, sideways overflow, or (with --axe) serious/critical violations.
//
//   node tools/peek.mjs --app=app --route=class --query='class=law&tab=lectures' --ready=class-lectures \
//        [--lang=pt] [--theme=dark] [--scale=1.25] [--size=1440x900] [--clock=2026-11-03T15:30] [--axe] \
//        [--out=/path/shot.png] [--port=1530] \
//        [--click=<testid>[,…]] [--press=<key>[,…]] [--type=<testid>=<text>] \
//        [--expect=<testid>[:<count>]] [--expect-not=<testid>] [--expect-text=<testid>=<substring>] \
//        [--expect-attr=<testid>:<attr>=<value|null>]
//
// Steps and assertions run in the order given, after the ready id appears; each may repeat.
import { resolve } from 'node:path';
import { shoot, startPeek, STEP_VERBS } from './peek-lib.mjs';

const opts = { steps: [] };
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=([\s\S]*))?$/.exec(a);
  if (!m) {
    console.error(`peek: unexpected argument ${a}`);
    process.exit(2);
  }
  const [, k, v = 'true'] = m;
  if (STEP_VERBS.includes(k)) opts.steps.push({ [k]: v });
  else opts[k] = v;
}
opts.axe = opts.axe === 'true';
opts.out = resolve(opts.out ?? `peek-${opts.route ?? 'home'}-${opts.lang ?? 'en'}-${opts.theme ?? 'light'}.png`);

const env = await startPeek({ app: opts.app ?? 'app', port: Number(opts.port) || 1530 });
let report;
try {
  report = await shoot(env, opts);
} finally {
  await env.close();
}
const { failed, ...rest } = report;
console.log(JSON.stringify(rest, null, 2));
process.exit(failed ? 1 : 0);
