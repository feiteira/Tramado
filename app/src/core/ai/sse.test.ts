import { describe, expect, it } from 'vitest';
import { createSseParser, resultFromBody, sseLines } from './sse';
import { fixtureText, savedCall, savedLines } from './fixtures.testutil';
import { sseLinesFor } from './fake';
import type { AiEvent } from './types';

const run = (lines: string[], end = true) => {
  const p = createSseParser();
  const events: AiEvent[] = [];
  for (const l of lines) events.push(...p.push(l));
  if (end) events.push(...p.end());
  return { events, r: p.result() };
};

describe('SSE parser (openrouter-lab §11.6)', () => {
  it('parses the saved stream (stream.txt): reasoning first, content, usage, [DONE], the answering model', () => {
    const { events, r } = run(sseLines(fixtureText('stream.txt')));
    expect(r.model).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(r.sawDone).toBe(true);
    expect(r.finish).toBe('stop');
    expect(r.content.length).toBeGreaterThan(20);
    expect(r.reasoning.length).toBeGreaterThan(20);
    expect(r.usage?.completion_tokens).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ kind: 'started', model: 'nvidia/nemotron-3.5-super-vl:free', provider: 'Nvidia' });
    const firstContent = events.findIndex((e) => e.kind === 'content');
    const firstReasoning = events.findIndex((e) => e.kind === 'reasoning');
    expect(firstReasoning).toBeLessThan(firstContent);
    expect(events.filter((e) => e.kind === 'done')).toHaveLength(1);
  });

  it('takes the FIRST finish_reason (the usage chunk repeats it) and ignores lines after [DONE]', () => {
    const { r, events } = run([...savedLines('t2_stream_a'), 'data: {"model":"x","choices":[{"delta":{"content":"late"}}]}']);
    expect(r.finish).toBe('stop');
    expect(r.content).not.toContain('late');
    expect(events.at(-1)).toMatchObject({ kind: 'done', finish: 'stop' });
  });

  it('counts heartbeats (": OPENROUTER PROCESSING") and skips event:/id: fields and bad JSON', () => {
    const { events, r } = run([': OPENROUTER PROCESSING', ': OPENROUTER PROCESSING', 'event: message', 'id: 7', 'data: {not json', ...sseLinesFor({ kind: 'text', text: 'Olá.', heartbeats: 0 })]);
    expect(r.heartbeats).toBe(2);
    expect(events.filter((e) => e.kind === 'heartbeat')).toHaveLength(2);
    expect(r.content).toBe('Olá.');
  });

  it('accumulates streamed tool-call fragments by index (t4_stream_toolcalls)', () => {
    const { r, events } = run(savedLines('t4_stream_toolcalls'));
    expect(r.finish).toBe('tool_calls');
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[0]!.function.name).toBe('search_materials');
    expect(JSON.parse(r.toolCalls[0]!.function.arguments)).toMatchObject({ query: expect.any(String) });
    expect(JSON.parse(r.toolCalls[1]!.function.arguments)).toMatchObject({ query: expect.any(String) });
    expect(r.toolCalls[1]!.id).toMatch(/^call-/);
    expect(events.filter((e) => e.kind === 'tool_calls')).toHaveLength(1);
  });

  it('reports a mid-stream error (top-level error, finish_reason "error") and stops', () => {
    const lines = sseLinesFor({ kind: 'midstream', text: 'Metade de uma', error: { code: 'server_error', message: 'Provider disconnected unexpectedly' } });
    const p = createSseParser();
    const events = lines.flatMap((l) => p.push(l));
    expect(events.at(-1)).toMatchObject({ kind: 'error', code: 'AI_UPSTREAM', detail: 'Provider disconnected unexpectedly' });
    expect(p.result().error?.message).toBe('Provider disconnected unexpectedly');
    expect(p.push('data: {"choices":[{"delta":{"content":"more"}}]}')).toEqual([]);
  });

  it('finishes a stream that closed without [DONE]', () => {
    const lines = sseLinesFor({ kind: 'text', text: 'Sem fim.', noDone: true });
    const { r, events } = run(lines);
    expect(r.sawDone).toBe(false);
    expect(r.done).toBe(true);
    expect(r.content).toBe('Sem fim.');
    expect(events.at(-1)).toMatchObject({ kind: 'done', finish: 'stop' });
  });

  it('skips the debug echo chunk and reads the ultra stream', () => {
    const { r } = run(savedLines('t2_stream_debug_ultra_schema'));
    expect(r.model).toContain('nemotron-3-ultra');
    expect(r.content).toContain('{');
  });

  it('reads a non-streamed body in the same shape (t1_fallback_a)', () => {
    const r = resultFromBody(savedCall('t1_fallback_a').response.json);
    expect(r.model).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(r.finish).toBe('stop');
    expect(r.content).toMatch(/separação de poderes/);
  });
});
