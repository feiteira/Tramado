// ReadableStream async iteration (`for await (const chunk of stream)`, Streams standard §4.2.5) for webviews that
// lack it: WebKitGTK before 2.52 (the Linux AppImage, built on Ubuntu 22.04, bundles WebKitGTK 2.50) and Safari
// before 26.4 (WKWebView on macOS). pdf.js 6 reads page text that way (PDFPageProxy.getTextContent), so without it
// every PDF extraction and every find in a PDF fails with "undefined is not a function". Installs `values()` and
// `[Symbol.asyncIterator]` only where they are missing; a webview that has them keeps its own.

interface ReaderLike {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}
interface StreamLike {
  getReader(): ReaderLike;
}

/** Adds the iteration methods to `ctor.prototype` (default: the global ReadableStream); true when it added any. */
export function installStreamIteration(ctor: { prototype: object } | undefined = globalThis.ReadableStream): boolean {
  if (!ctor) return false;
  const proto = ctor.prototype as Record<PropertyKey, unknown>;
  if (typeof proto[Symbol.asyncIterator] === 'function' && typeof proto.values === 'function') return false;

  function values(this: StreamLike, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    const preventCancel = Boolean(options?.preventCancel);
    let finished = false;
    return {
      async next() {
        if (finished) return { done: true, value: undefined };
        try {
          const r = await reader.read();
          if (r.done) {
            finished = true;
            reader.releaseLock();
          }
          return r;
        } catch (e) {
          finished = true;
          reader.releaseLock();
          throw e;
        }
      },
      async return(value?: unknown) {
        if (!finished) {
          finished = true;
          if (preventCancel) {
            reader.releaseLock();
          } else {
            const cancelled = reader.cancel(value);
            reader.releaseLock();
            await cancelled;
          }
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  const existing = typeof proto.values === 'function' ? proto.values : values;
  if (typeof proto.values !== 'function') Object.defineProperty(proto, 'values', { value: values, writable: true, configurable: true });
  if (typeof proto[Symbol.asyncIterator] !== 'function') Object.defineProperty(proto, Symbol.asyncIterator, { value: existing, writable: true, configurable: true });
  return true;
}

installStreamIteration();
