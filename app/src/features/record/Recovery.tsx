// Always mounted (OVERLAYS): opens the crash-recovery dialog for each interrupted recording found at start-up
// (UX §3.6.5), one at a time, and finishes "Download and transcribe" (UX §3.5.5): once the speech model a
// lecture waited for is ready, its transcription is claimed on this computer.
import { useEffect } from 'react';
import type { AppServices } from '../../services/types/common';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { useToast } from '../../ui/components/Toast';
import { pendingAfterModel } from '../lectures/actions';

/** Recordings whose recovery dialog was shown this session. */
export const handledRecoveries = new Set<string>();

export default function Recovery({ services }: { services: AppServices }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const pending = useStore(services.recording.pending);
  const models = useStore(services.models.models);
  const waiting = useStore(pendingAfterModel);

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
