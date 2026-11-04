import { describe, expect, it } from 'vitest';
import { globalAction, type KeyLike } from './globalKeys';

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const free = { inText: false, overModal: false };

describe('global keyboard map (UX §2.10)', () => {
  it('maps the Ctrl/⌘ shortcuts', () => {
    expect(globalAction(k('k', { ctrlKey: true }), free)).toEqual({ kind: 'palette' });
    expect(globalAction(k('K', { metaKey: true }), free)).toEqual({ kind: 'palette' });
    expect(globalAction(k('R', { ctrlKey: true, shiftKey: true }), free)).toEqual({ kind: 'record' });
    expect(globalAction(k(',', { ctrlKey: true }), free)).toEqual({ kind: 'settings' });
    expect(globalAction(k('H', { ctrlKey: true, shiftKey: true }), free)).toEqual({ kind: 'today' });
    expect(globalAction(k('J', { metaKey: true, shiftKey: true }), free)).toEqual({ kind: 'join' });
    expect(globalAction(k('3', { ctrlKey: true }), free)).toEqual({ kind: 'class', n: 3 });
    expect(globalAction({ ...k('#', { ctrlKey: true }), code: 'Digit3' }, free)).toEqual({ kind: 'class', n: 3 });
  });

  it('works while typing for Ctrl/⌘ keys, never over a modal', () => {
    expect(globalAction(k('k', { ctrlKey: true }), { inText: true, overModal: false })).toEqual({ kind: 'palette' });
    expect(globalAction(k('k', { ctrlKey: true }), { inText: false, overModal: true })).toBeNull();
    expect(globalAction(k('F1'), { inText: false, overModal: true })).toBeNull();
  });

  it('opens the shortcuts with F1 anywhere and ? only outside text fields', () => {
    expect(globalAction(k('F1'), { inText: true, overModal: false })).toEqual({ kind: 'shortcuts' });
    expect(globalAction(k('?', { shiftKey: true }), free)).toEqual({ kind: 'shortcuts' });
    expect(globalAction(k('?', { shiftKey: true }), { inText: true, overModal: false })).toBeNull();
  });

  it('goes back with Alt+← outside text unless a screen claims the arrows', () => {
    expect(globalAction(k('ArrowLeft', { altKey: true }), free)).toEqual({ kind: 'back' });
    expect(globalAction(k('ArrowLeft', { altKey: true }), { inText: true, overModal: false })).toBeNull();
    expect(globalAction(k('ArrowLeft', { altKey: true }), { ...free, screenClaimsAltArrows: true })).toBeNull();
  });

  it('ignores plain keys (screens own 1–4, N, Space…)', () => {
    for (const key of ['1', 'n', ' ', 'Escape', 'Enter']) expect(globalAction(k(key), free)).toBeNull();
    expect(globalAction(k('0', { ctrlKey: true }), free)).toBeNull();
  });
});
