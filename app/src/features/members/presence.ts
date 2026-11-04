// Presence and device lines of the Members tab (UX §3.12.1), as pure functions over the class detail, the folder's
// completion and the lectures (tested under Node). The first line that applies wins: recording, transcribing,
// editing, online (up to date / syncing), offline (last seen / never connected).
import type { FolderView } from '../../platform/types';
import type { Person } from '../../services/types/class';
import type { LectureView } from '../../services/types/viewModels';
import type { PresenceState } from '../../ui/tramado/PresenceDot';

export type PresenceLine =
  | { state: 'recording'; key: 'members.list.presence.recording' }
  | { state: 'transcribing'; key: 'members.list.presence.transcribing'; lecture: string; p: number }
  | { state: 'online'; key: 'members.list.presence.editing'; note: string }
  | { state: 'online'; key: 'members.list.presence.online' }
  | { state: 'syncing'; key: 'members.list.presence.onlineSyncing'; p: number }
  | { state: 'offline'; key: 'members.list.presence.lastSeen'; when: string }
  | { state: 'offline'; key: 'members.list.presence.never' };

/** The newest instant of a list (ISO strings compare as instants when they share a format). */
const newest = (xs: Array<string | null>): string | null => xs.reduce<string | null>((a, b) => (b && (!a || Date.parse(b) > Date.parse(a)) ? b : a), null);

/** A remote device's sync completion in a class (0–100), or null when unknown. */
export function completionOf(folder: FolderView | undefined, deviceId: string): number | null {
  const c = folder?.completion[deviceId];
  return c && c.remoteState === 'valid' ? c.completion : null;
}

/** "Notas/Resumo da aula.md" → "Resumo da aula". */
export const noteTitle = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

export function presenceLine(p: Person, folder: FolderView | undefined, lectures: readonly LectureView[]): PresenceLine {
  const live = p.devices.filter((d) => d.activity && !d.stale);
  if (live.some((d) => d.activity!.recording)) return { state: 'recording', key: 'members.list.presence.recording' };
  const tr = live.find((d) => d.activity!.transcribing)?.activity!.transcribing;
  if (tr) {
    const lecture = lectures.find((l) => l.id === tr.lectureId)?.title ?? '…';
    return { state: 'transcribing', key: 'members.list.presence.transcribing', lecture, p: Math.round(Math.max(0, Math.min(1, tr.progress)) * 100) };
  }
  const ed = live.find((d) => d.activity!.editing)?.activity!.editing;
  if (ed) return { state: 'online', key: 'members.list.presence.editing', note: noteTitle(ed.path) };
  const online = p.devices.filter((d) => d.online);
  if (online.length) {
    if (p.isMe) {
      const need = folder ? folder.needFiles : 0;
      const total = folder ? Math.max(1, folder.globalFiles) : 1;
      return need > 0 ? { state: 'syncing', key: 'members.list.presence.onlineSyncing', p: Math.floor(((total - need) / total) * 100) } : { state: 'online', key: 'members.list.presence.online' };
    }
    const done = online.map((d) => completionOf(folder, d.deviceId)).filter((x): x is number => x !== null);
    const least = done.length ? Math.min(...done) : 100;
    return least < 100 ? { state: 'syncing', key: 'members.list.presence.onlineSyncing', p: Math.floor(least) } : { state: 'online', key: 'members.list.presence.online' };
  }
  const seen = newest(p.devices.map((d) => d.lastSeen));
  return seen ? { state: 'offline', key: 'members.list.presence.lastSeen', when: seen } : { state: 'offline', key: 'members.list.presence.never' };
}

/** The presence dot shape of a line. */
export const dotOf = (l: PresenceLine): PresenceState => l.state;

export type DeviceLine =
  | { key: 'members.list.device.upToDate' }
  | { key: 'members.more.syncingFiles'; n: number }
  | { key: 'members.list.device.relay' }
  | { key: 'members.list.device.offline'; when: string }
  | { key: 'members.list.device.never' };

export function deviceLine(d: Person['devices'][number], self: boolean, folder: FolderView | undefined): DeviceLine {
  if (self) return folder && folder.needFiles > 0 ? { key: 'members.more.syncingFiles', n: folder.needFiles } : { key: 'members.list.device.upToDate' };
  if (d.online) {
    if (d.relay) return { key: 'members.list.device.relay' };
    const c = folder?.completion[d.deviceId];
    if (c && c.remoteState === 'valid' && c.completion < 100) return { key: 'members.more.syncingFiles', n: Math.max(1, c.needItems) };
    return { key: 'members.list.device.upToDate' };
  }
  return d.lastSeen ? { key: 'members.list.device.offline', when: d.lastSeen } : { key: 'members.list.device.never' };
}

/** "Large classes sync slowly" (G18): info above 30 members, warning above 50. */
export const largeTone = (members: number): 'info' | 'warning' | null => (members > 50 ? 'warning' : members > 30 ? 'info' : null);

/** Nobody organises the class any more: no organiser has a member file (UX §3.3.4, G6). */
export const organiserGone = (organisers: readonly string[], people: readonly Pick<Person, 'memberId'>[]): boolean =>
  organisers.length > 0 ? !people.some((p) => organisers.includes(p.memberId)) : people.length > 0;
