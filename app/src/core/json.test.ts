import { describe, expect, it } from 'vitest';
import { compactJson, jsonlLine, manifestJson } from './json';
import { PlatformError } from './errors';

describe('json', () => {
  it('writes manifests indented and lines compact', () => {
    expect(manifestJson({ a: 1, b: [1] })).toBe('{\n  "a": 1,\n  "b": [\n    1\n  ]\n}\n');
    expect(compactJson({ a: 1 })).toBe('{"a":1}');
    expect(jsonlLine({ a: 'x' })).toBe('{"a":"x"}\n');
  });

  it('refuses a line over 65 536 bytes', () => {
    expect(() => jsonlLine({ t: 'x'.repeat(65_536) })).toThrow(PlatformError);
    expect(jsonlLine({ t: 'x'.repeat(65_527) }).length).toBe(65_536);
  });
});
