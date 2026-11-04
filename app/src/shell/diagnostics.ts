// "Copy diagnostics" (UX §3.14.9, G20): what the app, sharing and speech report, as text for a bug report.
// Nothing is sent anywhere; device IDs are shortened, and no key or file content is included.
import type { AppServices } from '../services/types/common';

const shortIds = (s: string) => s.replace(/\b([A-Z2-7]{7})(-[A-Z2-7]{7}){7}\b/g, '$1');

export async function diagnosticsText(services: AppServices): Promise<string> {
  const { platform } = services.ctx;
  const lines: string[] = [];
  const info = await platform.info().catch(() => null);
  if (info) lines.push(`Tramado ${info.version} · ${info.os} ${info.arch}${info.webview ? ` · ${info.webview}` : ''}${info.mediaAudio ? ` · audio via ${info.mediaAudio}` : ''}`);
  const d = await platform.system.diagnostics().catch(() => null);
  if (d) {
    lines.push(`CPU: avx2 ${d.app.cpu.avx2 ? 'yes' : 'no'} · fma ${d.app.cpu.fma ? 'yes' : 'no'} · f16c ${d.app.cpu.f16c ? 'yes' : 'no'}`);
    lines.push(`Speech: ${d.speech.cpuOk ? 'supported' : 'not supported'} · VAD ${d.speech.vad ? 'yes' : 'no'} · models ${d.speech.models.map((m) => `${m.id}:${m.state}`).join(', ') || '—'}`);
    if (d.ai.lastCodes.length) lines.push(`AI errors: ${d.ai.lastCodes.map((c) => `${c.at} ${c.code}`).join('; ')}`);
  }
  const classes = services.library.classes.get();
  lines.push(`Classes: ${classes.length} (${classes.filter((c) => c.shared).length} shared, ${classes.filter((c) => c.archived).length} archived)`);
  const sync = await services.sync.diagnosticsText().catch(() => null);
  if (sync) lines.push('', sync);
  if (d?.logTail.length) lines.push('', 'Log:', ...d.logTail.slice(-200));
  return shortIds(lines.join('\n'));
}
