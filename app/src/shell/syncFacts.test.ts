import { describe, expect, it } from 'vitest';
import { factsOf } from './syncFacts';

const person = (memberId: string, name: string, online: boolean, isMe = false) => ({ memberId, name, isMe, devices: [{ online }] });

describe('factsOf (UX §2.4 "n = distinct members online, me excluded")', () => {
  it('counts each classmate once across classes, never me', () => {
    const f = factsOf([
      { classId: 'law', people: [person('ana', 'Ana', true, true), person('bruno', 'Bruno', true), person('carla', 'Carla', false)], conflicts: 0 },
      { classId: 'bio', people: [person('ana', 'Ana', true, true), person('jamie', 'Jamie', true), person('bruno', 'Bruno', true)], conflicts: 2 },
    ]);
    expect(f).toEqual({ online: 2, onlineNames: ['Bruno', 'Jamie'], conflicts: { bio: 2 } });
  });
  it('is empty without classes', () => {
    expect(factsOf([])).toEqual({ online: 0, onlineNames: [], conflicts: {} });
  });
});
