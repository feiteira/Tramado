import { describe, expect, it } from 'vitest';
import { jcs, jcsWithoutSig } from './jcs';

describe('RFC 8785 canonical JSON', () => {
  it('sorts keys by UTF-16 code units and drops whitespace', () => {
    expect(jcs({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}');
    // RFC 8785 §3.2.3 ordering example: "€" (€) sorts after "\r" and before "😀".
    const keys = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
    const order = [...jcs(keys).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(order).toEqual(['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33']);
  });

  it('serialises numbers as ECMAScript does (RFC 8785 §3.2.2.3 examples)', () => {
    expect(jcs([333333333.33333329, 1e30, 4.5, 2e-3, 0.000001, 1e-7, -0, 9007199254740992])).toBe(
      '[333333333.3333333,1e+30,4.5,0.002,0.000001,1e-7,0,9007199254740992]',
    );
    expect(() => jcs(Number.NaN)).toThrow();
  });

  it('escapes strings like JSON.stringify and drops sig', () => {
    expect(jcs({ s: ' \n"\\é' })).toBe('{"s":" \\n\\"\\\\é"}');
    expect(jcsWithoutSig({ b: 1, sig: { cert: 'x', value: 'y' }, a: undefined })).toBe('{"b":1}');
  });
});
