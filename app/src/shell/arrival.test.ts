import { describe, expect, it } from 'vitest';
import { focusAdrift, selectorFor } from './arrival';

const el = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });

describe('focus on arrival', () => {
  it('finds the control left behind again: its test id and which item it was', () => {
    expect(selectorFor(el({ 'data-testid': 'lecture-row', 'data-lecture-id': 'l-1', 'data-index': '2' }))).toBe('[data-testid="lecture-row"][data-lecture-id="l-1"]');
    expect(selectorFor(el({ 'data-testid': 'doc-import' }))).toBe('[data-testid="doc-import"]');
    expect(selectorFor(el({ 'data-testid': 'row', 'data-index': '4' }))).toBe('[data-testid="row"][data-index="4"]');
    // Nothing stable to find it by.
    expect(selectorFor(el({ id: 'x' }))).toBeNull();
    expect(selectorFor(null)).toBeNull();
  });

  it('counts the focus as adrift on the page, on a removed control, or on a hidden one', () => {
    const body = { isConnected: true, getClientRects: () => [1] };
    const doc = (active: unknown) => ({ activeElement: active, body, documentElement: {} }) as unknown as Document;
    expect(focusAdrift(doc(null))).toBe(true);
    expect(focusAdrift(doc(body))).toBe(true);
    expect(focusAdrift(doc({ isConnected: false, getClientRects: () => [1] }))).toBe(true);
    // The old screen hidden by Suspense while the next one loads.
    expect(focusAdrift(doc({ isConnected: true, getClientRects: () => [] }))).toBe(true);
    expect(focusAdrift(doc({ isConnected: true, getClientRects: () => [1] }))).toBe(false);
  });
});
