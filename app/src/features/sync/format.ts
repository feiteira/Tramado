// Small formatting helpers shared by the group screens (chat, members, sync dialogs, Settings › Sharing).
import type { I18n } from '../../ui/i18n';

/** "84 KB", "1.2 MB" (common.size.*), with the locale's decimal separator. */
export function formatSize(bytes: number, i18n: Pick<I18n, 't' | 'meta'>): string {
  const n = Math.max(0, bytes);
  const nf = (v: number, d: number) => new Intl.NumberFormat(i18n.meta.bcp47, { maximumFractionDigits: d }).format(v);
  if (n < 1000) return i18n.t('common.size.b', { n: nf(n, 0) });
  if (n < 1_000_000) return i18n.t('common.size.kb', { n: nf(n / 1000, 0) });
  if (n < 1_000_000_000) return i18n.t('common.size.mb', { n: nf(n / 1_000_000, n < 10_000_000 ? 1 : 0) });
  return i18n.t('common.size.gb', { n: nf(n / 1_000_000_000, 1) });
}

/** "Diogo Santos (Diogo’s laptop)" (a joining device's Syncthing name, sync spec §9.4) → person and computer. */
export function splitDeviceName(name: string): { person: string; device: string } {
  const m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(name.trim());
  return m ? { person: m[1]!, device: m[2]! } : { person: name.trim(), device: '' };
}

/** A device ID shortened to its first group, as diagnostics show it (UX §3.14.5). */
export const shortDevice = (deviceId: string): string => deviceId.split('-')[0] ?? deviceId;
