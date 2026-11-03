// STUB (M0) → T-AI owns this file from wave 1: createFakeAi() turns scripted answers into the same wire
// events Rust emits (architecture §10). Until then every send fails with AI_NO_KEY.
import type { Platform, PrivacyLevel } from '../types';

export interface FakeAiOptions { mode?: 'fake' | 'off' | 'busy' | 'quota' | 'badkey' | 'real' }

export function createFakeAi(_opts: FakeAiOptions = {}): Platform['ai'] {
  let privacy: PrivacyLevel = 'no-training';
  let busyRelax = false;
  return {
    async send(req, onEvent) {
      queueMicrotask(() => onEvent({ type: 'fail', code: 'AI_NO_KEY', message: `AI is not set up (request ${req.requestId})` }));
    },
    async cancel() {},
    async hosts() {
      return [];
    },
    async allowHost() {
      return null;
    },
    async forgetHost() {},
    async privacy() {
      return privacy;
    },
    async setPrivacy(level) {
      privacy = level;
      return true;
    },
    async busyPolicy() {
      return busyRelax;
    },
    async setBusyPolicy(relax) {
      busyRelax = relax;
      return true;
    },
    async activity() {
      return [];
    },
    async clearActivity() {},
  };
}
