import { describe, expect, it } from 'vitest';
import { installStreamIteration } from './streamIteration';

/** A stream class without the iteration methods (as in WebKitGTK 2.50), backed by a real ReadableStream. */
function legacyStreamClass() {
  class LegacyStream {
    cancelled: unknown = 'not cancelled';
    readonly inner: ReadableStream<number>;
    constructor(chunks: number[]) {
      this.inner = new ReadableStream<number>({
        start: (c) => {
          for (const x of chunks) c.enqueue(x);
          c.close();
        },
        cancel: (reason) => {
          this.cancelled = reason;
        },
      });
    }
    getReader() {
      return this.inner.getReader();
    }
  }
  return LegacyStream;
}

type Iterable = AsyncIterable<number> & { values(o?: { preventCancel?: boolean }): AsyncIterableIterator<number> };

describe('ReadableStream async iteration where the webview lacks it', () => {
  it('iterates every chunk and releases the reader at the end', async () => {
    const S = legacyStreamClass();
    expect(installStreamIteration(S)).toBe(true);
    const s = new S([1, 2, 3]);
    const got: number[] = [];
    for await (const x of s as unknown as Iterable) got.push(x);
    expect(got).toEqual([1, 2, 3]);
    expect(s.inner.locked).toBe(false);
  });

  it('cancels the stream when the loop ends early, unless preventCancel', async () => {
    const S = legacyStreamClass();
    installStreamIteration(S);
    const a = new S([1, 2, 3]);
    for await (const x of a as unknown as Iterable) if (x === 1) break;
    expect(a.cancelled).toBeUndefined();
    expect(a.inner.locked).toBe(false);
    const b = new S([1, 2, 3]);
    for await (const x of (b as unknown as Iterable).values({ preventCancel: true })) if (x === 1) break;
    expect(b.cancelled).toBe('not cancelled');
    expect(b.inner.locked).toBe(false);
  });

  it('keeps a native implementation', () => {
    expect(installStreamIteration(ReadableStream)).toBe(false);
    expect(installStreamIteration(undefined)).toBe(false);
  });
});
