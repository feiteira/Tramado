// The documents tab's pure logic (UX §3.7.1): which files and folders a folder shows, the Recent view, filter and
// sort, the text-state chip, and the import split (recordings, duplicates). No DOM, no services.
import { fold } from '../../core/search/text';
import type { DocSummary } from '../../services/types/documents';

export type SortKey = 'name' | 'date' | 'addedBy';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' };

/** The file picker of [Add documents…] (UX §3.7.1); any other type is copied as-is and shows "—". */
export const PICK_EXTENSIONS = ['pdf', 'docx', 'pptx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'];
const AUDIO_VIDEO = /\.(mp3|m4a|wav|ogg|oga|opus|flac|aac|weba|webm|mp4|mov|mkv|avi|m4v)$/i;
export const isRecordingName = (name: string) => AUDIO_VIDEO.test(name);

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Files of the documents directory (exam originals and lecture files live elsewhere). */
export function inDocuments(list: readonly DocSummary[], docsDir: string): DocSummary[] {
  return list.filter((d) => d.path.startsWith(`${docsDir}/`));
}

/** The folder path a route's `folder` (relative to the documents directory) points at. */
export const folderPath = (docsDir: string, rel: string | undefined | null) => (rel ? `${docsDir}/${rel.replace(/^\/+|\/+$/g, '')}` : docsDir);
export const relFolder = (docsDir: string, path: string) => (path === docsDir ? '' : path.slice(docsDir.length + 1));

/** The breadcrumb of a folder: [{ path, name }] from the documents directory down. */
export function crumbs(docsDir: string, folder: string): Array<{ path: string; name: string }> {
  const out = [{ path: docsDir, name: '' }];
  if (folder === docsDir || !folder.startsWith(`${docsDir}/`)) return out;
  let cur = docsDir;
  for (const part of folder.slice(docsDir.length + 1).split('/')) {
    cur = `${cur}/${part}`;
    out.push({ path: cur, name: part });
  }
  return out;
}

/** Direct sub-folders of `folder` (from the folder list and the files' directories). */
export function subFolders(folder: string, folders: readonly string[], files: readonly DocSummary[]): string[] {
  const set = new Set<string>();
  for (const f of folders) if (parentOf(f) === folder) set.add(f);
  for (const d of files) {
    let dir = d.dir;
    while (dir && dir.startsWith(`${folder}/`)) {
      if (parentOf(dir) === folder) set.add(dir);
      dir = parentOf(dir);
    }
  }
  return [...set].sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base', numeric: true }));
}

/** Counts files under each folder (any depth), for the folder rows. */
export function fileCounts(files: readonly DocSummary[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of files) {
    let dir = d.dir;
    while (dir) {
      out.set(dir, (out.get(dir) ?? 0) + 1);
      dir = parentOf(dir);
    }
  }
  return out;
}

/** True when every word of the filter is in the name (accent- and case-insensitive). */
export function matchesFilter(name: string, filter: string): boolean {
  const words = fold(filter).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const n = fold(name);
  return words.every((w) => n.includes(w));
}

export function sortDocs(list: readonly DocSummary[], sort: Sort, who: (d: DocSummary) => string = () => ''): DocSummary[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const byName = (a: DocSummary, b: DocSummary) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  return [...list].sort((a, b) => {
    let c = 0;
    if (sort.key === 'date') c = a.mtimeMs - b.mtimeMs;
    else if (sort.key === 'addedBy') c = who(a).localeCompare(who(b), undefined, { sensitivity: 'base' });
    return (c || byName(a, b)) * dir || byName(a, b);
  });
}

/** The visible rows of the tab: the folder's sub-folders and files (Folders view) or every file newest first (Recent). */
export function rowsFor(input: {
  files: readonly DocSummary[]; folders: readonly string[]; folder: string; view: 'folders' | 'recent'; filter: string; sort: Sort; who?: (d: DocSummary) => string;
}): { folders: string[]; shared: DocSummary[]; local: DocSummary[] } {
  const { files, view, filter } = input;
  const filtered = files.filter((d) => matchesFilter(d.name, filter));
  if (view === 'recent') {
    const recent = [...filtered].sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
    return { folders: [], shared: recent.filter((d) => !d.localOnly), local: recent.filter((d) => d.localOnly) };
  }
  // With a filter, the folder view searches the whole folder tree below the current folder.
  const here = filter.trim() ? filtered.filter((d) => d.dir === input.folder || d.dir.startsWith(`${input.folder}/`)) : filtered.filter((d) => d.dir === input.folder);
  const sorted = sortDocs(here, input.sort, input.who);
  const folders = filter.trim() ? [] : subFolders(input.folder, input.folders, files);
  return { folders, shared: sorted.filter((d) => !d.localOnly), local: sorted.filter((d) => d.localOnly) };
}

/** The "Text for search & AI" chip of a file (UX §3.7.1), from the extraction state. */
export type TextChip =
  | { kind: 'searchable' } | { kind: 'reading'; percent: number } | { kind: 'scan' } | { kind: 'somePages'; n: number }
  | { kind: 'failed' } | { kind: 'none' } | { kind: 'arriving' };

export function textChip(d: DocSummary, progress: number | undefined): TextChip {
  switch (d.extraction) {
    case 'ready': return d.imagePages ? { kind: 'somePages', n: d.imagePages } : { kind: 'searchable' };
    case 'running': return { kind: 'reading', percent: Math.round((progress ?? 0) * 100) };
    case 'pending': return d.sha256 ? { kind: 'reading', percent: 0 } : { kind: 'arriving' };
    case 'scan': return { kind: 'scan' };
    case 'failed': return { kind: 'failed' };
    case 'unsupported': return { kind: 'none' };
  }
}

/** The five folders of "Organise with folders?" (UX §3.7.1), as catalog keys (`documents.folders.*`). */
export const SUGGESTED_FOLDERS = ['slides', 'readings', 'legislation', 'pastExams', 'other'] as const;
