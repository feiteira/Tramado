// Settings › About (UX §3.14.9): the brand, the version, the licence and the source code; the keyboard shortcuts;
// diagnostics (copy, nothing is sent) and the audio playback self-test (R3); the licences of what Tramado is built
// from. No update checks in 0.1 (architecture Q3).
import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Keyboard, Volume2 } from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import { BrandMark } from '../../shell/BrandMark';
import { diagnosticsText } from '../../shell/diagnostics';
import { useDialogs } from '../../shell/useDialogs';
import { Button } from '../../ui/components/Button';
import { Notice } from '../../ui/components/Feedback';
import { Table, TBody, TD, TH, THead, TR } from '../../ui/components/Table';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { Group, Row, SectionRoot } from './Group';

const SOURCE = 'https://github.com/feiteira/Tramado';
const SEEK_S = 252;

/** UX §3.14.9: what Tramado ships, with its licence. */
export const LICENCES: ReadonlyArray<[string, string]> = [
  ['Syncthing 2.1.7', 'MPL-2.0'],
  ['whisper.cpp', 'MIT'],
  ['Whisper models', 'MIT'],
  ['Silero VAD', 'MIT'],
  ['libopus', 'BSD-3-Clause'],
  ['pdf.js', 'Apache-2.0'],
  ['mammoth', 'BSD-2-Clause'],
  ['lucide', 'ISC'],
  ['Figtree, Bricolage Grotesque, Source Serif 4, Atkinson Hyperlegible Next, OpenDyslexic', 'OFL-1.1'],
  ['qrcode', 'MIT'],
  ['React', 'MIT'],
  ['Tauri', 'MIT / Apache-2.0'],
  ['Trama', 'MPL-2.0'],
];

type MediaResult = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'fail'; detail: string };

/** Plays the bundled 5-minute recording through the media URL, seeks to 4:12 and checks where it landed. */
export async function mediaSelfTest(url: string, timeoutMs = 15_000): Promise<{ ok: true } | { ok: false; detail: string }> {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.muted = true;
  const wait = (ev: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${ev} after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      audio.addEventListener(ev, () => (clearTimeout(timer), resolve()), { once: true });
      audio.addEventListener('error', () => (clearTimeout(timer), reject(new Error(audio.error?.message || `media error ${audio.error?.code ?? ''}`.trim()))), { once: true });
    });
  try {
    audio.src = url;
    await wait('loadedmetadata');
    if (!Number.isFinite(audio.duration) || audio.duration < SEEK_S) return { ok: false, detail: `duration ${audio.duration}` };
    audio.currentTime = SEEK_S;
    await wait('seeked');
    const off = Math.abs(audio.currentTime - SEEK_S);
    return off <= 0.25 ? { ok: true } : { ok: false, detail: `seek landed at ${audio.currentTime.toFixed(2)} s` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    audio.removeAttribute('src');
    audio.load();
  }
}

/** The self-test on a Blob URL of the file's bytes, fetched over the media scheme (the Linux player's path). */
async function viaBlob(url: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  let blobUrl: string | null = null;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    blobUrl = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'audio/webm' }));
    return await mediaSelfTest(blobUrl);
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

export default function AboutSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const { platform } = services.ctx;
  const [version, setVersion] = useState('');
  const [media, setMedia] = useState<MediaResult>({ kind: 'idle' });
  useEffect(() => {
    void platform.info().then((i) => setVersion(i.version), () => undefined);
  }, [platform]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await diagnosticsText(services));
      toast.show({ message: t('settings.about.diagnosticsCopied'), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  };
  const test = async () => {
    setMedia({ kind: 'testing' });
    // The path the player uses (architecture §8): on Linux WebKitGTK's <audio> refuses the custom scheme, so the
    // player plays a Blob URL of the bytes (AppInfo.mediaAudio 'blob'); the test does the same there.
    const url = platform.media.url({ kind: 'selftest' });
    const info = await platform.info().catch(() => null);
    const r = info?.mediaAudio === 'blob' ? await viaBlob(url) : await mediaSelfTest(url);
    setMedia(r.ok ? { kind: 'ok' } : { kind: 'fail', detail: r.detail });
  };
  const openSource = () =>
    void platform.system
      .openExternal(SOURCE, { title: t('app.external.title'), message: t('app.external.body', { host: 'github.com' }), confirm: t('app.external.open'), cancel: t('common.cancel') })
      .catch((e: unknown) => toast.error(e));
  return (
    <SectionRoot testid="settings-about" title={t('settings.sections.about')}>
      <div className="about-hero">
        <BrandMark size={48} />
        <div>
          <p className="about-hero__name" data-testid="about-version">{t('settings.about.version', { version })}</p>
          <p className="about-hero__tagline">{t('settings.about.tagline')}</p>
          <button type="button" className="link about-hero__source" onClick={openSource} data-testid="about-source">
            {t('settings.about.source')}
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <Group id="about-keys">
        <Row label={t('settings.about.shortcuts')}>
          <Button size="sm" icon={Keyboard} onClick={() => dialogs.open('shortcuts', {})} data-testid="about-shortcuts">
            {t('settings.about.show')}
          </Button>
        </Row>
      </Group>
      <Group id="about-diagnostics" title={t('settings.about.diagnostics')}>
        <Row stack>
          <div className="set-inline set-inline--start">
            <Button size="sm" icon={Copy} onClick={() => void copy()} data-testid="about-copy-diagnostics">
              {t('settings.about.copyDiagnostics')}
            </Button>
            <Button size="sm" icon={Volume2} busy={media.kind === 'testing'} onClick={() => void test()} data-testid="about-media-test">
              {t('settings.about.mediaTest')}
            </Button>
          </div>
          {media.kind === 'ok' ? <Notice tone="success" data-testid="about-media-result" data-state="ok">{t('settings.about.mediaOk')}</Notice> : null}
          {media.kind === 'fail' ? <Notice tone="warning" data-testid="about-media-result" data-state="fail">{t('settings.about.mediaFail', { detail: media.detail })}</Notice> : null}
          {media.kind === 'testing' ? <p className="set-row__hint" role="status">{t('settings.about.mediaTesting')}</p> : null}
        </Row>
      </Group>
      <Group id="about-licences" title={t('settings.about.licences')}>
        <div className="set-table-wrap">
          <Table label={t('settings.about.licences')} dense data-testid="about-licences">
            <THead>
              <TR>
                <TH scope="col">{t('settings.about.component')}</TH>
                <TH scope="col">{t('settings.about.licence')}</TH>
              </TR>
            </THead>
            <TBody>
              {LICENCES.map(([name, licence]) => (
                <TR key={name}>
                  <TD translate="no">{name}</TD>
                  <TD className="t-tabular">{licence}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Group>
    </SectionRoot>
  );
}
