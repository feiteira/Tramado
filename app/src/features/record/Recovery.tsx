// Always mounted (OVERLAYS): opens the crash-recovery dialog for each interrupted recording found at start-up
// (UX §3.6.5), one at a time, and finishes "Download and transcribe" (UX §3.5.5): once the speech model a
// lecture waited for is ready, its transcription is claimed on this computer.
import { useEffect, useRef } from 'react';
import type { AppServices } from '../../services/types/common';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { useToast } from '../../ui/components/Toast';
import { pendingAfterModel } from '../lectures/actions';
import { useI18n } from '../../ui/i18n';

/** Settings › Transcription's opt-in OS-global marker shortcuts (UX §3.14.4). */
export const MARKER_SHORTCUTS = { important: 'CmdOrCtrl+Alt+1', confused: 'CmdOrCtrl+Alt+2', exam: 'CmdOrCtrl+Alt+3', todo: 'CmdOrCtrl+Alt+4' } as const;

/** Recordings whose recovery dialog was shown this session. */
export const handledRecoveries = new Set<string>();

export default function Recovery({ services }: { services: AppServices }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const pending = useStore(services.recording.pending);
  const models = useStore(services.models.models);
  const waiting = useStore(pendingAfterModel);
  const queue = useStore(services.transcription.state);
  const { t } = useI18n();
  const asked = useRef(false);

  // The opt-in global marker shortcuts are registered again at every start.
  useEffect(() => {
    if (services.ctx.prefs.get('speech.markerShortcuts') !== '1' || !services.ctx.platform.speech) return;
    void services.ctx.platform.system.setMarkerShortcuts({ ...MARKER_SHORTCUTS }).catch(() => undefined);
  }, [services]);

  // The one-time volunteering notice (UX §3.14.4): "This computer will help transcribe…" [Turn off].
  useEffect(() => {
    if (!queue.volunteerNotice || asked.current) return;
    asked.current = true;
    void services.transcription.ackVolunteerNotice(false).catch(() => undefined);
    toast.show({ message: t('notify.volunteerOn'), durationMs: 12_000, action: { label: t('speech.turnOff'), run: () => services.transcription.ackVolunteerNotice(true), testId: 'volunteer-turn-off' } });
  }, [queue.volunteerNotice, services, toast, t]);

  useEffect(() => {
    if (dialogs.current) return;
    const next = pending.find((r) => r.state === 'recovered' && !handledRecoveries.has(r.recordingId));
    if (!next) return;
    handledRecoveries.add(next.recordingId);
    dialogs.open('recover', { recording: next });
  }, [pending, dialogs]);

  useEffect(() => {
    if (!waiting || !models.some((m) => m.state === 'ready')) return;
    pendingAfterModel.set(null);
    void services.transcription.claim(waiting.classId, waiting.lectureId, 'local').catch((e: unknown) => toast.error(e));
  }, [waiting, models, services, toast]);

  return null;
}
