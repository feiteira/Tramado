// G1 (integrator): a minimal palette search over SearchService.passages, grouped by kind (UX §3.13 headings), so
// the real app finds what it indexed (desktop-smoke --flow=g1). UI-DOCS replaces it in wave 2 (snippets with hit
// marks, "Show all", Ask AI, recent searches, navigation on `run`).
import { catalogs } from '../../core/i18n/catalogs';
import { isUiLocale } from '../../core/i18n/languages';
import { translate } from '../../core/i18n/translate';
import type { SourceRef } from '../../core/model/files';
import type { AppServices } from '../../services/types/common';
import type { PaletteGroup } from '../registry';

const GROUPS: Array<{ kind: SourceRef['kind']; id: 'lectures' | 'documents' | 'notes' | 'exams'; icon: string }> = [
  { kind: 'lecture', id: 'lectures', icon: 'mic' },
  { kind: 'document', id: 'documents', icon: 'file-text' },
  { kind: 'note', id: 'notes', icon: 'notebook-pen' },
  { kind: 'exam', id: 'exams', icon: 'clipboard-list' },
];

export default function provider(services: AppServices) {
  return {
    id: 'search',
    async search(q: string, ctx: { classId: string | null }, signal: AbortSignal): Promise<PaletteGroup[]> {
      const locale = services.ctx.prefs.get('ui.locale');
      const messages = catalogs[isUiLocale(locale) ? locale : 'en'];
      const passages = await services.search.passages(ctx.classId ?? 'all', q, { limit: 20 });
      if (signal.aborted) return [];
      return GROUPS.map((g) => ({
        id: g.id,
        label: translate(messages, catalogs.en, `search.groups.${g.id}`),
        items: passages
          .filter((p) => p.source.kind === g.kind)
          .slice(0, 5)
          .map((p) => ({ id: p.id, label: p.title ?? p.label, detail: `${p.label} · ${p.text.replace(/\s+/g, ' ').slice(0, 120)}`, icon: g.icon, run: () => undefined })),
      })).filter((g) => g.items.length > 0);
    },
  };
}
