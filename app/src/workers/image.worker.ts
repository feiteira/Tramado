// The image worker (architecture §11.7; critique G10.3): ImagePrep (EXIF orientation applied by
// `createImageBitmap(…, { imageOrientation: 'from-image' })`, the long side scaled down to `maxSide`,
// JPEG at `quality`) and PdfRender (pdf.js pages drawn on an OffscreenCanvas in this thread, for OCR
// of scanned exam pages). No DOM: OffscreenCanvas only.
import './streamIteration';
import { PlatformError } from '../core/errors';
import { serveRpc } from './rpc';

interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: unknown; viewport: unknown; canvas?: unknown }): { promise: Promise<void> };
  cleanup(): unknown;
}
interface PdfLib {
  getDocument(src: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPageLike> }>; destroy(): Promise<void> };
}

/** pdf.js canvases for a worker: OffscreenCanvas instead of document.createElement('canvas'). */
class OffscreenCanvasFactory {
  constructor(_opts: unknown) {}
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(c: { canvas: OffscreenCanvas }, width: number, height: number) {
    c.canvas.width = width;
    c.canvas.height = height;
  }
  destroy(c: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (c.canvas) {
      c.canvas.width = 0;
      c.canvas.height = 0;
    }
    c.canvas = null;
    c.context = null;
  }
}

let pdfjs: Promise<PdfLib> | null = null;
function loadPdfjs(): Promise<PdfLib> {
  pdfjs ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')]).then(([lib, worker]) => {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return lib as unknown as PdfLib;
  });
  return pdfjs;
}

async function toJpeg(source: CanvasImageSource & { width: number; height: number }, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PlatformError('UNSUPPORTED_FILE', 'no 2D canvas');
  ctx.fillStyle = '#ffffff';   // transparent PNGs become white, not black, in JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
}

async function openPdf(bytes: ArrayBuffer) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0, CanvasFactory: OffscreenCanvasFactory, useSystemFonts: false });
  return { task, doc: await task.promise };
}

serveRpc(self as unknown as Parameters<typeof serveRpc>[0], {
  async prepare(args) {
    const [bytes, mime, maxSide, quality] = args as [ArrayBuffer, string, number, number];
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'from-image' });
    } catch (e) {
      throw new PlatformError('UNSUPPORTED_FILE', `cannot decode the image: ${String(e)}`);
    }
    try {
      return await toJpeg(bitmap, maxSide, quality);
    } finally {
      bitmap.close();
    }
  },
  async pages(args) {
    const { task, doc } = await openPdf(args[0] as ArrayBuffer);
    try {
      return doc.numPages;
    } finally {
      await task.destroy();
    }
  },
  async renderJpeg(args) {
    const [bytes, n, maxSide] = args as [ArrayBuffer, number, number];
    const { task, doc } = await openPdf(bytes);
    try {
      if (n < 1 || n > doc.numPages) throw new PlatformError('INVALID', `no page ${n}`);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new PlatformError('UNSUPPORTED_FILE', 'no 2D canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      page.cleanup();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      await task.destroy();
    }
  },
});
