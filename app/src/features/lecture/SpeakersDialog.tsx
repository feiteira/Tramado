// "Speakers…" (UX §3.5.1 [⋯], OQ15: in 0.1 with transcript corrections): rename the speaker labels of a
// transcript. Each changed label is a `label_speaker` edit line (folder spec §8.9, ≤ 40 characters, LWW).
import React, { useState } from 'react';
import type { ClassId, Ulid } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';

const MAX = 40;

export function SpeakersDialog({ services, classId, lectureId, speakers, onClose }: { services: AppServices; classId: ClassId; lectureId: Ulid; speakers: ReadonlyArray<{ id: string; label: string }>; onClose(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(speakers.map((s) => [s.id, s.label])));
  const [busy, setBusy] = useState(false);
  const valid = speakers.every((s) => (labels[s.id] ?? '').trim().length > 0 && [...(labels[s.id] ?? '').trim()].length <= MAX);
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      for (const s of speakers) {
        const next = (labels[s.id] ?? '').replace(/\s+/g, ' ').trim();
        if (next && next !== s.label) await services.forClass(classId).lectures.edit.labelSpeaker(lectureId, s.id, next);
      }
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={t('lectures.speakers.title')}
      description={t('lectures.speakers.body')}
      onSubmit={() => void save()}
      data-testid="speakers-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!valid} busy={busy} data-testid="speakers-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="speakers-list">
        {speakers.map((s, i) => (
          <TextField
            key={s.id}
            label={t('lectures.speakers.label', { n: i + 1 })}
            value={labels[s.id] ?? ''}
            maxLength={MAX}
            onChange={(v) => setLabels((l) => ({ ...l, [s.id]: v }))}
            hint={t('lectures.speakers.hint', { n: MAX })}
            data-testid="speakers-input"
          />
        ))}
      </div>
    </Dialog>
  );
}
