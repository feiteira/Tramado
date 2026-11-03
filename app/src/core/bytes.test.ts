import { describe, expect, it } from 'vitest';
import { decodeText, fromWindows1252, utf8 } from './bytes';

describe('decodeText', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(decodeText(utf8('Inês Conceição;€'))).toBe('Inês Conceição;€');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Nome;Telemóvel')]))).toBe('Nome;Telemóvel');
  });

  it('falls back to Windows-1252 for an Excel CSV saved in Portugal or Spain', () => {
    // "Nome;Telemóvel\nInês Conceição;Peña “€”" as Excel writes it on Windows.
    const bytes = new Uint8Array([
      0x4e, 0x6f, 0x6d, 0x65, 0x3b, 0x54, 0x65, 0x6c, 0x65, 0x6d, 0xf3, 0x76, 0x65, 0x6c, 0x0a,
      0x49, 0x6e, 0xea, 0x73, 0x20, 0x43, 0x6f, 0x6e, 0x63, 0x65, 0x69, 0xe7, 0xe3, 0x6f, 0x3b, 0x50, 0x65, 0xf1, 0x61, 0x20, 0x93, 0x80, 0x94,
    ]);
    expect(decodeText(bytes)).toBe('Nome;Telemóvel\nInês Conceição;Peña “€”');
  });

  it('reads UTF-16 files that start with a byte-order mark', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x49, 0, 0x6e, 0, 0xea, 0, 0x73, 0]))).toBe('Inês');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0, 0x49, 0, 0x6e, 0, 0xea, 0, 0x73]))).toBe('Inês');
  });

  it('maps every Windows-1252 byte to one character', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = fromWindows1252(all);
    expect(text).toHaveLength(256);
    expect(text[0xe9]).toBe('é');
    expect(text[0x80]).toBe('€');
    expect(text[0x9c]).toBe('œ');
  });
});
