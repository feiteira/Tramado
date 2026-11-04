import { describe, expect, it } from 'vitest';
import { tolerantParse } from './tolerantJson';
import { savedCall } from './fixtures.testutil';
import { resultFromBody } from './sse';

describe('tolerantParse (openrouter-lab §5, critique R14)', () => {
  it('reads plain JSON, fenced JSON and JSON inside prose', () => {
    expect(tolerantParse('{"a":1}')).toEqual({ a: 1 });
    expect(tolerantParse('Here you go:\n```json\n{"a": [1, 2]}\n```\nDone.')).toEqual({ a: [1, 2] });
    expect(tolerantParse('O resultado é {"q": "x"} conforme pedido.')).toEqual({ q: 'x' });
    expect(tolerantParse('[{"n":1},{"n":2}]')).toEqual([{ n: 1 }, { n: 2 }]);
  });
  it('repairs trailing commas, smart quotes and comments', () => {
    expect(tolerantParse('{“a”: 1, "b": [1,2,],}')).toEqual({ a: 1, b: [1, 2] });
    expect(tolerantParse('{\n// a comment\n"a": NaN}')).toEqual({ a: null });
  });
  it('returns null for nothing usable', () => {
    expect(tolerantParse('')).toBeNull();
    expect(tolerantParse(null)).toBeNull();
    expect(tolerantParse('no json here')).toBeNull();
    expect(tolerantParse('{"a": ')).toBeNull();
  });
  it('reads the saved model outputs: Gemma fenced its own structure; ultra followed the prompt schema', () => {
    const gemma = tolerantParse(resultFromBody(savedCall('t5_gemma26_strict').response.json).content) as Record<string, unknown>;
    expect(gemma).not.toBeNull();
    const ultra = tolerantParse(resultFromBody(savedCall('t5_ultra_prompt_only').response.json).content) as { questions: unknown[] };
    expect(ultra.questions.length).toBeGreaterThanOrEqual(7);
  });
});
