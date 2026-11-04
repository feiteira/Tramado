// Presence and device lines of the Members tab (UX §3.12.1), the organiser vacancy and the large-class advisory.
import { describe, expect, it } from 'vitest';
import type { FolderView } from '../../platform/types';
import type { Person } from '../../services/types/class';
import { deviceLine, largeTone, noteTitle, organiserGone, presenceLine } from './presence';
import { codeOfLink } from './DeepLinks';

const dev = (over: Partial<Person['devices'][number]> = {}): Person['devices'][number] => ({
  deviceId: 'D1', deviceName: 'Laptop', verified: true, online: false, relay: false, lastSeen: null,
  caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' }, app: { name: 'Tramado', version: '0.1.0', platform: 'linux' }, activity: null, stale: false, ...over,
});
const person = (devices: Person['devices'], over: Partial<Person> = {}): Person => ({ memberId: 'm', name: 'Bruno', colour: null, isMe: false, isOrganiser: false, banned: false, devices, ...over });
const folder = (completion: FolderView['completion'], needFiles = 0): FolderView => ({
  classId: 'c', label: 'x', path: '/x', paused: false, state: 'idle', globalFiles: 10, inSyncFiles: 10 - needFiles, needFiles, needBytes: 0, pullErrors: 0, error: null, devices: [], completion,
});

describe('presence lines', () => {
  it('takes the first line that applies', () => {
    const lectures = [{ id: 'L1', title: 'Aula 8' }] as never;
    expect(presenceLine(person([dev({ online: true, activity: { recording: { draftId: 'x', startedAt: 'x', mode: 'room' } } })]), undefined, lectures).key).toBe('members.list.presence.recording');
    expect(presenceLine(person([dev({ online: true, activity: { transcribing: { lectureId: 'L1', progress: 0.4 } } })]), undefined, lectures)).toMatchObject({ state: 'transcribing', lecture: 'Aula 8', p: 40 });
    expect(presenceLine(person([dev({ online: true, activity: { editing: { path: 'Notas/Resumo.md', since: 'x' } } })]), undefined, lectures)).toMatchObject({ note: 'Resumo' });
    // a stale activity is ignored
    expect(presenceLine(person([dev({ online: true, stale: true, activity: { recording: { draftId: 'x', startedAt: 'x', mode: 'room' } } })]), undefined, lectures).key).toBe('members.list.presence.online');
    expect(presenceLine(person([dev({ online: true })]), folder({ D1: { completion: 55, needItems: 3, remoteState: 'valid' } }), lectures)).toMatchObject({ state: 'syncing', p: 55 });
    expect(presenceLine(person([dev({ lastSeen: '2026-11-03T12:25:00Z' }), dev({ deviceId: 'D2', lastSeen: '2026-10-31T21:40:00Z' })]), undefined, lectures)).toMatchObject({ state: 'offline', when: '2026-11-03T12:25:00Z' });
    expect(presenceLine(person([dev()]), undefined, lectures).key).toBe('members.list.presence.never');
    expect(presenceLine(person([dev({ online: true })], { isMe: true }), folder({}, 5), lectures)).toMatchObject({ state: 'syncing', p: 50 });
  });

  it('device lines', () => {
    expect(deviceLine(dev({ online: true, relay: true }), false, undefined).key).toBe('members.list.device.relay');
    expect(deviceLine(dev({ online: true }), false, folder({ D1: { completion: 80, needItems: 4, remoteState: 'valid' } }))).toEqual({ key: 'members.more.syncingFiles', n: 4 });
    expect(deviceLine(dev({ lastSeen: '2026-11-01T00:00:00Z' }), false, undefined)).toEqual({ key: 'members.list.device.offline', when: '2026-11-01T00:00:00Z' });
    expect(deviceLine(dev(), true, folder({})).key).toBe('members.list.device.upToDate');
    expect(noteTitle('a/b/Resumo da aula.MD')).toBe('Resumo da aula');
  });

  it('organiser vacancy and large classes', () => {
    expect(organiserGone(['ana'], [{ memberId: 'bruno' }])).toBe(true);
    expect(organiserGone(['ana'], [{ memberId: 'ana' }])).toBe(false);
    expect(largeTone(30)).toBeNull();
    expect(largeTone(31)).toBe('info');
    expect(largeTone(51)).toBe('warning');
  });

  it('finds the code of deep links and invite files', () => {
    const code = `tri1_${'A'.repeat(60)}`;
    expect(codeOfLink({ url: `tramado://join/${code}` })).toBe(code);
    expect(codeOfLink({ url: 'file:', text: `tramado://join/${code}\nOpen this file with Tramado to join DC I.` })).toBe(code);
    expect(codeOfLink({ url: `https://example.org/join/#${encodeURIComponent(code)}` })).toBe(code);
    expect(codeOfLink({ url: 'tramado://other' })).toBeNull();
  });
});
