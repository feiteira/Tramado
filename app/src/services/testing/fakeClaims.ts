// STUB (M0) → T-LECTURES: a ClaimEngine test double whose claims always win (architecture §11.2).
import { constant } from '../store';
import type { ClaimEngine } from '../types/sync';

export function createFakeClaims(outcome: 'won' | 'lost' = 'won'): ClaimEngine & { tried: string[] } {
  const tried: string[] = [];
  return {
    tried,
    claims: () => constant([]),
    winner: () => null,
    tryClaim: async (lectureId) => {
      tried.push(lectureId);
      return outcome;
    },
    onLost: () => () => undefined,
    setStatus: async () => undefined,
    remove: async () => undefined,
    sweep: async () => undefined,
  };
}
