// pdf.js for the document view (UX §3.7.2): pdfjs-dist (legacy build, as the extraction worker uses, for
// WebKitGTK) with `web/pdf_viewer.mjs` (PDFViewer, EventBus, PDFLinkService, PDFFindController) loaded lazily.
//
// Standard fonts, CMaps and the image-decoder wasm are bundled from pdfjs-dist as hashed assets
// (import.meta.glob ?url) and handed to pdf.js through a BinaryDataFactory, so no Vite or package.json change is
// needed. If the glob finds nothing (another node_modules layout), PDFs still render with system fonts.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type ViewerLib = typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs');

const FONTS = import.meta.glob('../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?no-inline&url', import: 'default', eager: true, exhaustive: true }) as Record<string, string>;
const CMAPS = import.meta.glob('../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?no-inline&url', import: 'default', eager: true, exhaustive: true }) as Record<string, string>;
const WASM = import.meta.glob('../../../../node_modules/pdfjs-dist/wasm/*.{wasm,js}', { query: '?no-inline&url', import: 'default', eager: true, exhaustive: true }) as Record<string, string>;

const byName = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.slice(k.lastIndexOf('/') + 1), v]));
const ASSETS = { standardFontDataUrl: byName(FONTS), cMapUrl: byName(CMAPS), wasmUrl: byName(WASM) } as const;
export const HAS_STANDARD_FONTS = Object.keys(ASSETS.standardFontDataUrl).length > 0;

/** Serves pdf.js's built-in data files from the bundled assets (pdf.js asks by kind and file name). */
class AssetDataFactory {
  constructor(_: unknown) {
    void _;
  }
  async fetch({ kind, filename }: { kind: keyof typeof ASSETS; filename: string }): Promise<Uint8Array> {
    const url = ASSETS[kind]?.[filename];
    if (!url) throw new Error(`pdf.js data file not bundled: ${filename}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`pdf.js data file ${filename}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

let loading: Promise<{ lib: PdfLib; viewer: ViewerLib }> | null = null;

/** Loads pdf.js and its viewer once (the viewer module reads `globalThis.pdfjsLib`). */
export function loadPdfjs(): Promise<{ lib: PdfLib; viewer: ViewerLib }> {
  loading ??= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    (globalThis as { pdfjsLib?: unknown }).pdfjsLib = lib;
    const viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
    await import('pdfjs-dist/legacy/web/pdf_viewer.css');
    return { lib, viewer };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** getDocument options for the bundled data files (no eval: the CSP has no unsafe-eval). */
export function documentOptions(): Record<string, unknown> {
  return {
    isEvalSupported: false,
    useWorkerFetch: false,
    BinaryDataFactory: AssetDataFactory,
    // The URLs only switch the features on; AssetDataFactory resolves the files.
    cMapUrl: 'bundled:/cmaps/', cMapPacked: true,
    standardFontDataUrl: 'bundled:/standard_fonts/',
    wasmUrl: 'bundled:/wasm/',
    useSystemFonts: !HAS_STANDARD_FONTS,
    enableXfa: false,
    verbosity: 0,
  };
}
