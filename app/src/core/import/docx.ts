import { zipSync } from 'fflate';
import { htmlToParagraphs } from './html';
import { canonicalize, tidy } from './text';
import { ImportError, WARNING, warning } from './types';
import { readZip, zipNames } from './xml';

// Word (.docx) → text through mammoth's HTML (headings, paragraphs, lists, tables, footnotes),
// then our HTML reader. mammoth reads { buffer } in Node and { arrayBuffer } in the browser
// build; we pass both so the same call works in Vitest and in the webview.

/** The part of mammoth we use (structural, so the Node and browser builds both fit). */
export interface MammothLike {
  convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { convertImage?: unknown; ignoreEmptyParagraphs?: boolean; styleMap?: string | string[] },
  ): Promise<{ value: string; messages: unknown[] }>;
  images: { imgElement(f: (image: unknown) => Promise<{ src: string }>): unknown };
}

let loaded: Promise<MammothLike> | null = null;

/** mammoth, loaded on first use (it is large and only needed for Word files). */
export function loadMammoth(): Promise<MammothLike> {
  loaded ??= import('mammoth').then((m) => {
    const mod = m as unknown as { default?: MammothLike } & Partial<MammothLike>;
    return mod.default ?? (mod as MammothLike);
  });
  return loaded;
}

export interface DocxResult {
  text: string;
  warnings: string[];
}

/** Parts mammoth never reads (images are only counted, embedded objects ignored). */
const UNREAD_PART = /^word\/(?:media|embeddings)\/|\.(?:png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp|wdp|heic|avif)$/i;

/**
 * The .docx rebuilt from parts we inflated ourselves, within limits. mammoth's JSZip inflates
 * whatever part the relationships name with no limit and trusts no declared size, so it must
 * only ever see entries whose sizes are already verified: those are stored uncompressed, and
 * the parts mammoth never reads are left empty.
 */
function boundedDocx(bytes: Uint8Array): Uint8Array {
  let parts: Record<string, Uint8Array>;
  let names: string[];
  try {
    parts = readZip(bytes, (name) => !UNREAD_PART.test(name));
    names = zipNames(bytes);
  } catch (e) {
    if (e instanceof ImportError && e.code === 'DAMAGED') throw new ImportError('DAMAGED', 'docx', e.message);
    throw e;
  }
  const files: Record<string, Uint8Array> = {};
  for (const name of names) files[name] = parts[name] ?? new Uint8Array(0);
  return zipSync(files, { level: 0 });
}

export async function docxToText(bytes: Uint8Array, mammoth?: MammothLike): Promise<DocxResult> {
  const safe = boundedDocx(bytes);
  const m = mammoth ?? (await loadMammoth());
  let images = 0;
  const ab = safe.buffer as ArrayBuffer;
  let html: string;
  try {
    const result = await m.convertToHtml({ arrayBuffer: ab, buffer: ab } as { arrayBuffer: ArrayBuffer }, {
      // Images would arrive as huge data: URIs; count them instead.
      convertImage: m.images.imgElement(() => {
        images++;
        return Promise.resolve({ src: '' });
      }),
    });
    html = result.value;
  } catch (e) {
    throw new ImportError('DAMAGED', 'docx', e instanceof Error ? e.message : String(e));
  }
  const warnings = images ? [warning(WARNING.imagesSkipped, images)] : [];
  return { text: tidy(canonicalize(htmlToParagraphs(html, { literal: true }).join('\n'))), warnings };
}
