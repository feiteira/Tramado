// Unit locator → the folder spec §8.15 Locator of one passage (architecture §11.1 `locators.ts`).
// Units already carry spec locators (core/import/units.ts, core/transcript/units.ts); a passage
// narrows them: a transcript passage points at the characters of its first hit inside the segment
// (research trama-ts §5(a): "the time of the first hit, not the paragraph start"), a `text` locator
// takes the passage's own offsets, and a long article's window keeps the article's page range.
import type { Locator } from '../model/files';
import { pageOf } from '../import/pdfPages';

export interface LocatedUnit { start: number; end: number; locator: Locator }

/** The unit that contains `pos` (units sorted by start, non-overlapping), or null. */
export function unitContaining<U extends { start: number; end: number }>(units: readonly U[], pos: number): U | null {
  let lo = 0;
  let hi = units.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (units[mid]!.start <= pos) lo = mid + 1;
    else hi = mid;
  }
  const u = lo > 0 ? units[lo - 1]! : null;
  return u && pos < u.end ? u : null;
}

/**
 * The locator of a passage [start, end) found in a unit: the unit's locator narrowed to the passage
 * (and to its first hit for transcripts). `hits` are document offsets.
 */
export function passageLocator(unit: LocatedUnit | null, start: number, end: number, hits: ReadonlyArray<{ start: number; end: number }>, extractor: string): Locator {
  if (!unit) return { type: 'text', start, end, extractor };
  const loc = unit.locator;
  switch (loc.type) {
    case 'segment': {
      const first = hits[0] ?? { start, end };
      return { ...loc, charStart: Math.max(0, first.start - unit.start), charEnd: Math.max(0, first.end - unit.start) };
    }
    case 'text':
      return { type: 'text', start, end, extractor: loc.extractor };
    default:
      return loc;
  }
}

/** The physical page a locator opens at (documents), or null. */
export function locatorPage(loc: Locator): number | null {
  if (loc.type === 'page') return loc.page;
  if (loc.type === 'article') return loc.pages?.[0] ?? null;
  return null;
}

/** A page locator for an offset of a PDF text (with the printed label when it differs). */
export function pageLocatorAt(pageStarts: readonly number[], pageLabels: ReadonlyArray<string | null> | undefined, pos: number): Locator {
  const page = pageOf(pageStarts, pos);
  const label = pageLabels?.[page - 1];
  return label ? { type: 'page', page, pageLabel: label } : { type: 'page', page };
}

/** Do two locators point at the same place (for de-duplicating passages and annotations)? */
export function sameLocator(a: Locator, b: Locator): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'page': return a.page === (b as typeof a).page;
    case 'article': return a.article === (b as typeof a).article;
    case 'slide': return a.slide === (b as typeof a).slide;
    case 'segment': return a.segmentId === (b as typeof a).segmentId;
    case 'heading': return a.path.join('\u0000') === (b as typeof a).path.join('\u0000') && a.paragraph === (b as typeof a).paragraph;
    case 'text': return a.start === (b as typeof a).start && a.end === (b as typeof a).end;
    case 'whole': return true;
  }
}
