// PLACEHOLDER (M0) → UI-DOCS: the palette's search results (UX §3.13). Returns no groups until then.
import type { AppServices } from '../../services/types/common';
import type { PaletteGroup } from '../registry';

export default function provider(services: AppServices) {
  void services;
  return { id: 'search', search: async (): Promise<PaletteGroup[]> => [] };
}
