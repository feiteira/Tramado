// The rail's recording dot (UX §2.3, §3.6.3): tone 'danger' while this computer records the class. The rail
// shows the rec dot for it (and for classmates recording, from ClassView.recordingBy).
import { derived } from '../../services/store';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';

export default function railBadge(services: AppServices, classId: ClassId) {
  return derived(
    services.recording.state,
    (s): { count: number; tone: 'neutral' | 'info' | 'danger' } | null => (s && s.classId === classId ? { count: 0, tone: 'danger' } : null),
    (a, b) => (a === null) === (b === null),
  );
}
