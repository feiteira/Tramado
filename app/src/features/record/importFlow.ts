// "Add a recording…" (UX §3.6.6): the file picker (audio and video, plus subtitles), then the import dialog.
import type { ClassId } from '../../core/model/ids';
import type { Picked } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'webm', 'mp4', 'mov', 'mkv'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm'] as const;

export const isSubtitle = (name: string) => /\.vtt$/i.test(name);
export const isVideo = (name: string) => /\.(mp4|mov|mkv)$/i.test(name);

/** Opens the picker; returns the picks (empty when cancelled). */
export async function pickRecording(services: AppServices, title: string, labels: { audio: string; subtitles: string }): Promise<Picked[]> {
  return services.ctx.platform.dialogs.pickFiles({
    title,
    multiple: true,
    filters: [
      { name: labels.audio, extensions: [...AUDIO_EXTENSIONS] },
      { name: labels.subtitles, extensions: ['vtt'] },
    ],
  });
}

export async function startImport(
  services: AppServices,
  classId: ClassId,
  open: <I extends 'import'>(id: I, props: DialogPropsMap[I]) => void,
  t: (key: never, vars?: Record<string, string | number>) => string,
): Promise<void> {
  const tt = t as unknown as (k: string) => string;
  const picked = await pickRecording(services, tt('lectures.list.import'), { audio: tt('record.import.filterAudio'), subtitles: tt('record.import.filterSubtitles') }).catch(() => [] as Picked[]);
  if (picked.length === 0) return;
  open('import', { classId, picked });
}
