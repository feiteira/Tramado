// Typed request/response over postMessage between the app and its Web Workers (architecture §11.7).
// T-DOCS owns this file from wave 1.
import { PlatformError, toPlatformError } from '../core/errors';

export interface RpcRequest { id: number; method: string; args: unknown[] }
export type RpcReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; code: string; message: string }
  | { id: number; progress: number };

interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

/** The app side: `call(method, args)` resolves with the worker's value; `onProgress` gets progress replies. */
export function createRpcClient(port: PortLike) {
  let next = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; onProgress?: (p: number) => void }>();
  port.addEventListener('message', (e: MessageEvent) => {
    const r = e.data as RpcReply;
    const p = pending.get(r.id);
    if (!p) return;
    if ('progress' in r) return p.onProgress?.(r.progress);
    pending.delete(r.id);
    if (r.ok) p.resolve(r.value);
    else p.reject(new PlatformError(toPlatformError({ code: r.code, message: r.message }).code, r.message));
  });
  return {
    call<T>(method: string, args: unknown[], opts: { transfer?: Transferable[]; onProgress?: (p: number) => void } = {}): Promise<T> {
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}) });
        port.postMessage({ id, method, args } satisfies RpcRequest, opts.transfer ?? []);
      });
    },
  };
}

/** The worker side: dispatches requests to `handlers`; a handler may report progress. */
export function serveRpc(port: PortLike, handlers: Record<string, (args: unknown[], progress: (p: number) => void) => unknown>): void {
  port.addEventListener('message', (e: MessageEvent) => {
    const req = e.data as RpcRequest;
    const handler = handlers[req.method];
    const progress = (p: number) => port.postMessage({ id: req.id, progress: p } satisfies RpcReply);
    Promise.resolve()
      .then(() => {
        if (!handler) throw new PlatformError('INVALID', `no worker method ${req.method}`);
        return handler(req.args, progress);
      })
      .then(
        (value) => port.postMessage({ id: req.id, ok: true, value } satisfies RpcReply),
        (err: unknown) => {
          const p = toPlatformError(err);
          port.postMessage({ id: req.id, ok: false, code: p.code, message: p.message } satisfies RpcReply);
        },
      );
  });
}
