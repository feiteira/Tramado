// What the recording UI remembers between its parts during one session: whether Stop was ours (so an
// unexpected end shows the "The recording stopped" row), the save in progress (the dock's "Saving the
// recording…"), and the share choice made at Start (the Save dialog's default, UX §3.6.4).
import { Store } from '../../services/store';
import type { ClassId, Ulid } from '../../core/model/ids';
import type { ShareMode } from '../../platform/types';

export const session = {
  /** Stop was pressed here (not a failure). */
  stopping: new Store<boolean>(false),
  /** "Saving the recording…": the recording being published. */
  saving: new Store<{ recordingId: Ulid; classId: ClassId; title: string } | null>(null),
  /** The recording ended without Stop: what is known about it. */
  failed: new Store<{ classId: ClassId; title: string; recordingId: Ulid | null } | null>(null),
};

/** The share choice of the last start per class (also in prefs `record.<classId>`). */
export function shareAtStart(raw: string | undefined): ShareMode {
  try {
    const v = raw ? (JSON.parse(raw) as { share?: ShareMode }) : null;
    return v?.share === 'transcript-only' || v?.share === 'none' ? v.share : 'audio+transcript';
  } catch {
    return 'audio+transcript';
  }
}
