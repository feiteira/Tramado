// What the demo's hooks drive (architecture §11.6, verbatim). The fakes implement their parts: files
// (memory platform), ai (platform/memory/ai.ts, T-AI), sync (platform/memory/sync.ts, T-SYNC), speech
// (platform/memory/speech.ts, T-LECTURES). Frozen after M0.
import type { ErrorCode } from '../core/errors';
import type { DialogAnswer } from '../platform/memory';

export interface DemoControls {
  files: { addFile(classKey: string, relPath: string, base64: string): Promise<void>; queueAnswer(a: DialogAnswer): void };
  ai?: { next(textOrFn: string | ((req: unknown) => string)): void; fail(code: ErrorCode): void };
  sync?: { peerSays(classKey: string, memberKey: string, text: string): Promise<void>;
           peerAdds(classKey: string, memberKey: string, relPath: string, base64: string): Promise<void>;
           peerJoins(classKey: string, name: string, deviceName: string): Promise<void>;
           setOnline(memberKey: string, online: boolean): void };
  speech?: { claimTranscription(lectureKey: string, memberKey: string, percent: number): Promise<void>;
             finishTranscription(lectureKey: string): Promise<void>; tick(ms: number): void };
}
