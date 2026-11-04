// The search worker (architecture §11.7, D16): one PassageIndex per class, answering the IndexHost
// messages of workers/rpc.ts with the same engine the inline host uses (workers/engine.ts).
import { createIndexEngine } from './engine';
import { serveRpc } from './rpc';

const engine = createIndexEngine();
type Args = unknown[];
const call = <K extends keyof typeof engine>(k: K) => (args: Args) => (engine[k] as (...a: Args) => unknown)(...args);

serveRpc(self as unknown as Parameters<typeof serveRpc>[0], {
  load: call('load'),
  upsert: call('upsert'),
  remove: call('remove'),
  query: call('query'),
  passage: call('passage'),
  find: call('find'),
  stats: call('stats'),
});
