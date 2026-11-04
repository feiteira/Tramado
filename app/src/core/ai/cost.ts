// Request estimates per feature (critique G11, C17; UX §3.15.7): what the CostLine shows before a request or batch.

export const LECTURE_CHUNK_CHARS = 40_000;
export const DEEP_PER_QUESTION = 6;            // a tool loop takes 4–8 requests; the estimate shows the middle

export type CostTask =
  | 'ask' | 'ask-expand' | 'explain' | 'hint' | 'chat'
  | 'exam-text' | 'exam-pages' | 'exam-quick' | 'exam-deep'
  | 'summary' | 'terms' | 'annotate' | 'studyNotes';

/**
 * Requests a task takes. `count` means: pages to read for `exam-pages` (photos and scanned PDFs, + 1 extraction),
 * questions for `exam-quick` (+ 1 expansion) and `exam-deep`, transcript characters for the lecture tools
 * (⌈chars / 40 000⌉ + 1, UX §3.5.4).
 */
export function estimateRequests(task: CostTask | string, count = 1): number {
  const n = Math.max(0, Math.floor(count));
  switch (task) {
    case 'ask': case 'explain': case 'hint': case 'chat': case 'exam-text': return 1;
    case 'ask-expand': return 2;
    case 'exam-pages': return n + 1;
    case 'exam-quick': return n === 0 ? 0 : n + 1;
    case 'exam-deep': return n * DEEP_PER_QUESTION;
    // UX §3.5.4: n = ⌈transcript chars / 40 000⌉ + 1 (a one-part lecture actually takes 1; the line says "about").
    case 'summary': case 'terms': case 'annotate': case 'studyNotes': return Math.max(1, Math.ceil(n / LECTURE_CHUNK_CHARS)) + 1;
    default: return Math.max(1, n);
  }
}
