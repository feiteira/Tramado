// window.__tramadoDemo (UX §7.2): the hooks the screenshot steps and the e2e tests call, delegating to
// DemoControls. A hook whose fake is not built yet rejects with NOT_IMPLEMENTED. Frozen after M0.
import { notImplemented, type ErrorCode } from '../core/errors';
import type { DialogAnswer } from '../platform/memory';
import type { DemoControls } from './controls';

export interface TramadoDemoHooks {
  addFile(classKey: string, relPath: string, base64: string): Promise<void>;
  queueAnswer(a: DialogAnswer): void;
  peerSays(classKey: string, memberKey: string, text: string): Promise<void>;
  peerAdds(classKey: string, memberKey: string, relPath: string, base64: string): Promise<void>;
  peerJoins(classKey: string, name: string, deviceName: string): Promise<void>;
  claimTranscription(lectureKey: string, memberKey: string, percent: number): Promise<void>;
  finishTranscription(lectureKey: string): Promise<void>;
  aiNext(textOrFn: string | ((req: unknown) => string)): void;
  aiFail(code: ErrorCode): void;
  setOnline(memberKey: string, online: boolean): void;
  tick(ms: number): void;
  /** True once the app is in its ready phase (the screenshot pipeline waits for it). */
  ready: boolean;
}

declare global {
  interface Window {
    __tramadoDemo?: TramadoDemoHooks;
  }
}

export function makeHooks(c: DemoControls): TramadoDemoHooks {
  const missing = (what: string) => {
    throw notImplemented(`demo.${what}`);
  };
  const reject = (what: string) => Promise.reject(notImplemented(`demo.${what}`));
  return {
    addFile: (classKey, relPath, base64) => c.files.addFile(classKey, relPath, base64),
    queueAnswer: (a) => c.files.queueAnswer(a),
    peerSays: (k, m, text) => (c.sync ? c.sync.peerSays(k, m, text) : reject('peerSays')),
    peerAdds: (k, m, p, b) => (c.sync ? c.sync.peerAdds(k, m, p, b) : reject('peerAdds')),
    peerJoins: (k, n, d) => (c.sync ? c.sync.peerJoins(k, n, d) : reject('peerJoins')),
    claimTranscription: (l, m, p) => (c.speech ? c.speech.claimTranscription(l, m, p) : reject('claimTranscription')),
    finishTranscription: (l) => (c.speech ? c.speech.finishTranscription(l) : reject('finishTranscription')),
    aiNext: (x) => (c.ai ? c.ai.next(x) : missing('aiNext')),
    aiFail: (code) => (c.ai ? c.ai.fail(code) : missing('aiFail')),
    setOnline: (m, on) => (c.sync ? c.sync.setOnline(m, on) : missing('setOnline')),
    tick: (ms) => {
      c.media?.tick(ms);
      c.speech?.tick(ms);
    },
    ready: false,
  };
}

export function installHooks(c: DemoControls): TramadoDemoHooks {
  const hooks = makeHooks(c);
  if (typeof window !== 'undefined') window.__tramadoDemo = hooks;
  return hooks;
}
