// Runs a command with NAME=value variables set, without a shell (cross-platform `env`):
//   node scripts/env-run.mjs TRAMADO_PROPERTY_RUNS=2000 -- vitest run property
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
const vars = sep < 0 ? [] : args.slice(0, sep);
const cmd = sep < 0 ? args : args.slice(sep + 1);
const env = { ...process.env };
for (const v of vars) {
  const i = v.indexOf('=');
  if (i > 0) env[v.slice(0, i)] = v.slice(i + 1);
}
if (!cmd.length) {
  console.error('usage: env-run.mjs NAME=value … -- command args…');
  process.exit(2);
}
const win = process.platform === 'win32';
const child = spawn(win ? `${cmd[0]}.cmd` : cmd[0], cmd.slice(1), { env, stdio: 'inherit', shell: false });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
