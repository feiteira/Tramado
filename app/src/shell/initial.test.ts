import { describe, expect, it } from 'vitest';
import { initial } from './initial';

describe('initial', () => {
  it('takes the first letter, upper-cased', () => {
    expect(initial('fieldwork 2026')).toBe('F');
    expect(initial('  Éticas do cuidado')).toBe('É');
  });
  it('keeps a decomposed accent with its letter', () => {
    expect(initial('ética')).toBe('É');
  });
  it('keeps a whole emoji', () => {
    expect(initial('👩🏽‍🔬 lab notes')).toBe('👩🏽‍🔬');
  });
  it('is empty for blank names', () => {
    expect(initial('')).toBe('');
    expect(initial('   ')).toBe('');
  });
});
