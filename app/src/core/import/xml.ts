import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { Inflate, strFromU8 } from 'fflate';
import { ImportError } from './types';

// Shared helpers for the zip-of-XML formats (ODT, XLSX, DOCX): bounded unzipping and a parser
// that fails with DAMAGED instead of logging to the console.

/** More than this, uncompressed, in one entry is a zip bomb or not something we can hold. */
export const MAX_ENTRY = 512 * 1024 * 1024;
/** Most all the inflated entries of one file may add up to. */
export const MAX_TOTAL = 1024 * 1024 * 1024;

/** Compressed bytes inflated per step: deflate expands at most ~1032x, so one step stays small. */
const INFLATE_STEP = 16 * 1024;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

const damaged = (message: string) => new ImportError('DAMAGED', 'zip', message);

/** The central directory, read by hand so that every record (duplicates included) is seen. */
function listZip(b: Uint8Array): ZipEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (at: number) => v.getUint16(at, true);
  const u32 = (at: number) => v.getUint32(at, true);
  const u64 = (at: number) => u32(at) + u32(at + 4) * 2 ** 32;
  const stop = Math.max(0, b.length - 22 - 0xffff);
  let e = b.length - 22;
  while (e >= stop && u32(e) !== 0x06054b50) e--;
  if (e < stop) throw damaged('not a ZIP archive');
  let count = u16(e + 10);
  let at = u32(e + 16);
  if (e >= 20 && u32(e - 20) === 0x07064b50) {
    const z = u64(e - 12);
    if (z + 56 <= b.length && u32(z) === 0x06064b50) {
      count = u64(z + 32);
      at = u64(z + 48);
    }
  }
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > b.length || u32(at) !== 0x02014b50) throw damaged('bad central directory');
    const flags = u16(at + 8);
    const nameLen = u16(at + 28);
    const extraLen = u16(at + 30);
    const commentLen = u16(at + 32);
    if (at + 46 + nameLen + extraLen > b.length) throw damaged('bad central directory');
    const entry: ZipEntry = {
      name: strFromU8(b.subarray(at + 46, at + 46 + nameLen), !(flags & 0x800)),
      flags,
      method: u16(at + 10),
      crc: u32(at + 16),
      csize: u32(at + 20),
      usize: u32(at + 24),
      offset: u32(at + 42),
    };
    // ZIP64: the real values follow in an extra field, in this order, for each one maxed out.
    if (entry.usize === 0xffffffff || entry.csize === 0xffffffff || entry.offset === 0xffffffff) {
      for (let x = at + 46 + nameLen; x + 4 <= at + 46 + nameLen + extraLen; ) {
        const id = u16(x);
        const size = u16(x + 2);
        if (id === 1) {
          let y = x + 4;
          const next = () => {
            if (y + 8 > x + 4 + size) throw damaged('bad ZIP64 field');
            const n = u64(y);
            y += 8;
            return n;
          };
          if (entry.usize === 0xffffffff) entry.usize = next();
          if (entry.csize === 0xffffffff) entry.csize = next();
          if (entry.offset === 0xffffffff) entry.offset = next();
          break;
        }
        x += 4 + size;
      }
    }
    out.push(entry);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** One entry, inflated step by step: refused the moment it outgrows its declared size. */
function inflateEntry(b: Uint8Array, e: ZipEntry): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (e.flags & 1) throw damaged(`${e.name} is encrypted`);
  if (e.offset + 30 > b.length || v.getUint32(e.offset, true) !== 0x04034b50) throw damaged(`bad local header for ${e.name}`);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  if (start + e.csize > b.length) throw damaged(`${e.name} is truncated`);
  const data = b.subarray(start, start + e.csize);
  let out: Uint8Array;
  if (e.method === 0) {
    if (data.length !== e.usize) throw damaged(`size mismatch in ${e.name}`);
    out = data.slice();
  } else if (e.method === 8) {
    out = new Uint8Array(e.usize);
    let n = 0;
    const inflater = new Inflate((chunk) => {
      if (n + chunk.length > e.usize) throw damaged(`${e.name} inflates past its declared size`);
      out.set(chunk, n);
      n += chunk.length;
    });
    try {
      if (!data.length) inflater.push(data, true);
      for (let i = 0; i < data.length; i += INFLATE_STEP) inflater.push(data.subarray(i, i + INFLATE_STEP), i + INFLATE_STEP >= data.length);
    } catch (err) {
      if (err instanceof ImportError) throw err;
      throw damaged(`${e.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (n !== e.usize) throw damaged(`size mismatch in ${e.name}`);
  } else {
    throw damaged(`unsupported compression in ${e.name}`);
  }
  if (crc32(out) !== e.crc) throw damaged(`checksum mismatch in ${e.name}`);
  return out;
}

/**
 * Inflates the entries `want` accepts, every one bounded: each entry's declared size and the
 * total are checked before anything is inflated (TOO_LARGE), an entry that inflates past its
 * declared size is stopped there, and its length and CRC must match (DAMAGED). A wanted name
 * stored twice is DAMAGED: it would be inflated twice, and a reader could take either copy.
 */
export function readZip(bytes: Uint8Array, want: (name: string) => boolean): Record<string, Uint8Array> {
  let entries: ZipEntry[];
  try {
    entries = listZip(bytes);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw damaged(e instanceof Error ? e.message : String(e));
  }
  const seen = new Set<string>();
  const wanted: ZipEntry[] = [];
  let total = 0;
  for (const e of entries) {
    if (e.name.endsWith('/') || !want(e.name)) continue;
    if (seen.has(e.name)) throw damaged(`${e.name} appears twice`);
    seen.add(e.name);
    total += e.usize;
    if (e.usize > MAX_ENTRY || total > MAX_TOTAL) throw new ImportError('TOO_LARGE', e.name);
    wanted.push(e);
  }
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const e of wanted) files[e.name] = inflateEntry(bytes, e);
  return files;
}

/** Every entry name in the archive (directories excluded). Throws DAMAGED like readZip. */
export function zipNames(bytes: Uint8Array): string[] {
  try {
    return listZip(bytes).map((e) => e.name).filter((n) => !n.endsWith('/'));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw damaged(e instanceof Error ? e.message : String(e));
  }
}

export function zipText(files: Record<string, Uint8Array>, name: string): string | null {
  const b = files[name];
  if (!b) return null;
  // XML files may start with a UTF-8 BOM.
  return strFromU8(b).replace(/^\u{feff}/u, '');
}

export function parseXml(xml: string, what: string): Document {
  try {
    return new DOMParser({
      locator: false,
      onError: (level, msg) => {
        if (level === 'fatalError') throw new Error(msg);
      },
    }).parseFromString(xml, 'text/xml');
  } catch (e) {
    throw new ImportError('DAMAGED', what, e instanceof Error ? e.message : String(e));
  }
}

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const CDATA_SECTION_NODE = 4;

export function isElement(n: Node | null | undefined): n is Element {
  return !!n && n.nodeType === ELEMENT_NODE;
}

/** Child elements (in order), optionally only those with this namespace and local name. */
export function childElements(parent: Node, ns?: string, local?: string): Element[] {
  const out: Element[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (isElement(c) && (ns === undefined || (c.namespaceURI === ns && c.localName === local))) out.push(c);
  }
  return out;
}

export function firstChild(parent: Node, ns: string, local: string): Element | null {
  for (let c = parent.firstChild; c; c = c.nextSibling) if (isElement(c) && c.namespaceURI === ns && c.localName === local) return c;
  return null;
}

/** Every descendant element with this namespace and local name, in document order. */
export function descendants(root: Node, ns: string, local: string): Element[] {
  const out: Element[] = [];
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isElement(c)) continue;
      if (c.namespaceURI === ns && c.localName === local) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Concatenated text of all descendant text nodes. */
export function textContent(n: Node): string {
  let s = '';
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === TEXT_NODE || c.nodeType === CDATA_SECTION_NODE) s += c.nodeValue ?? '';
    else if (isElement(c)) s += textContent(c);
  }
  return s;
}
