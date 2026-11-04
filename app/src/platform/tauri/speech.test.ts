import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from '../../core/errors';
import type { ModelEvent, RecorderEvent, TranscribeEvent, TranscribeRequest } from '../types';

// The speech bindings of architecture §6.8 against a fake Tauri core (Trama pattern): command names, camelCase
// top-level arguments, struct arguments as the Rust serde types expect them, and the job channels (D-7).
// The shell side is `cargo test -p tramado-speech`.

type Call = { cmd: string; args: Record<string, unknown> | undefined };
const calls: Call[] = [];
let respond: (cmd: string, args: Record<string, unknown> | undefined) => unknown = () => undefined;

class FakeChannel<T> {
  onmessage: (e: T) => void = () => undefined;
}
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return respond(cmd, args);
  }),
  Channel: FakeChannel,
}));

const { createSpeechBindings } = await import('./speech');

const CLASS = 'tramado-mde5jfv46prdf2fjxvmbjr4242';
const LECTURE = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';

beforeEach(() => {
  calls.length = 0;
  respond = () => undefined;
});

function channelOf<T>(i: number): FakeChannel<T> {
  return calls[i]!.args!['onEvent'] as FakeChannel<T>;
}

describe('speech bindings', () => {
  it('model commands send the registry id and pass channel events through', async () => {
    const s = createSpeechBindings();
    const seen: ModelEvent[] = [];
    await s.downloadModel('turbo', (e) => seen.push(e));
    await s.attachModel('turbo', (e) => seen.push(e));
    await s.cancelModel('small');
    await s.deleteModel('large-v3');
    await s.importModel('small', 'pick-1');
    expect(calls.map((c) => c.cmd)).toEqual([
      'speech_model_download', 'speech_model_attach', 'speech_model_cancel', 'speech_model_delete', 'speech_model_import',
    ]);
    expect(calls[0]!.args!['modelId']).toBe('turbo');
    expect(calls[2]!.args).toEqual({ modelId: 'small' });
    expect(calls[4]!.args).toEqual({ modelId: 'small', pick: 'pick-1' });
    channelOf<ModelEvent>(0).onmessage({ type: 'progress', done: 10, total: 100, bytesPerSec: 5 });
    channelOf<ModelEvent>(1).onmessage({ type: 'verifying' });
    expect(seen).toEqual([{ type: 'progress', done: 10, total: 100, bytesPerSec: 5 }, { type: 'verifying' }]);
  });

  it('recorder commands use the Rust request structs and the channel of the start call', async () => {
    const s = createSpeechBindings();
    const events: RecorderEvent[] = [];
    respond = (cmd) => (cmd === 'speech_recorder_attach' ? null : undefined);
    const req = {
      recordingId: LECTURE, classId: CLASS, title: 'Aula 7', mode: 'online' as const, includeMic: true,
      inputDeviceId: null, language: 'pt-PT' as const, bitrate: 32000 as const, markerOffsetMs: 3000,
    };
    await s.recorder.start(req, (e) => events.push(e));
    expect(await s.recorder.attach((e) => events.push(e))).toBeNull();
    await s.recorder.pause();
    await s.recorder.resume();
    await s.recorder.mark('important');
    await s.recorder.unmark(LECTURE);
    await s.recorder.mark('note', 'rever', 41_000.4);
    await s.recorder.stop();
    await s.recorder.pending();
    await s.recorder.publish({ recordingId: LECTURE, classId: CLASS, lectureDir: 'Aulas/Aula 7', share: 'transcript-only' });
    await s.recorder.discard(LECTURE);
    expect(calls.map((c) => c.cmd)).toEqual([
      'speech_recorder_start', 'speech_recorder_attach', 'speech_recorder_pause', 'speech_recorder_resume',
      'speech_recorder_mark', 'speech_recorder_unmark', 'speech_recorder_mark', 'speech_recorder_stop', 'speech_recordings_pending',
      'speech_recording_publish', 'speech_recording_discard',
    ]);
    expect(calls[0]!.args!['req']).toEqual(req);
    // No `note` key at all when there is no note (Rust `Option` skipped).
    expect(calls[4]!.args).toEqual({ m: { kind: 'important' } });
    expect(calls[5]!.args).toEqual({ markerId: LECTURE });
    expect(calls[6]!.args).toEqual({ m: { kind: 'note', note: 'rever', atMs: 41_000 } });
    expect(calls[9]!.args).toEqual({ req: { recordingId: LECTURE, classId: CLASS, lectureDir: 'Aulas/Aula 7', share: 'transcript-only' } });
    expect(calls[10]!.args).toEqual({ recordingId: LECTURE });
    channelOf<RecorderEvent>(0).onmessage({ type: 'warning', code: 'silentMic' });
    channelOf<RecorderEvent>(1).onmessage({ type: 'stopped', reason: 'diskFull', code: 'DISK_FULL' });
    expect(events.map((e) => e.type)).toEqual(['warning', 'stopped']);
  });

  it('meter, devices and imports', async () => {
    const s = createSpeechBindings();
    await s.devices();
    await s.meter.start({ inputDeviceId: 'pulseaudio:alsa_input.usb', mode: 'room' }, () => undefined);
    await s.meter.stop();
    await s.importAudio({ recordingId: LECTURE, pick: 'pick-2', classId: CLASS, lectureDir: 'Aulas/Zoom', keepVideo: false }, () => undefined);
    await s.attachImport(LECTURE, () => undefined);
    expect(calls.map((c) => c.cmd)).toEqual([
      'speech_devices', 'speech_meter_start', 'speech_meter_stop', 'speech_import_audio', 'speech_import_attach',
    ]);
    expect(calls[1]!.args!['req']).toEqual({ inputDeviceId: 'pulseaudio:alsa_input.usb', mode: 'room' });
    expect(calls[3]!.args!['req']).toMatchObject({ pick: 'pick-2', keepVideo: false });
    expect(calls[4]!.args!['recordingId']).toBe(LECTURE);
  });

  it('transcription: start, attach, cancel, jobs, take and peaks', async () => {
    const s = createSpeechBindings();
    respond = (cmd) => (cmd === 'speech_transcribe_start' ? 'job-1' : cmd === 'speech_jobs' ? [] : undefined);
    const req: TranscribeRequest = {
      jobId: 'job-1', lectureId: LECTURE, source: { kind: 'class', classId: CLASS, path: 'Aulas/Aula 7/audio.webm' },
      expectSha256: 'a'.repeat(64), engine: { kind: 'local', model: 'turbo' }, language: 'auto', channels: 'mix',
      initialPrompt: 'Código Civil', claim: null, resume: true,
    };
    const events: TranscribeEvent[] = [];
    expect(await s.transcribe.start(req, (e) => events.push(e))).toBe('job-1');
    await s.transcribe.attach('job-1', (e) => events.push(e));
    await s.transcribe.cancel('job-1', true);
    expect(await s.transcribe.jobs()).toEqual([]);
    await s.transcribe.take('job-1');
    await s.peaks({ kind: 'class', classId: CLASS, path: 'Aulas/Aula 7/audio.webm' }, 800);
    expect(calls.map((c) => c.cmd)).toEqual([
      'speech_transcribe_start', 'speech_transcribe_attach', 'speech_transcribe_cancel', 'speech_jobs',
      'speech_transcribe_take', 'speech_peaks',
    ]);
    expect(calls[0]!.args!['req']).toEqual(req);
    expect(calls[2]!.args).toEqual({ jobId: 'job-1', keepPartial: true });
    expect(calls[5]!.args).toEqual({ req: { source: { kind: 'class', classId: CLASS, path: 'Aulas/Aula 7/audio.webm' }, buckets: 800 } });
    channelOf<TranscribeEvent>(0).onmessage({ type: 'phase', phase: 'vad' });
    channelOf<TranscribeEvent>(1).onmessage({ type: 'progress', progress: 0.5, etaMs: 60000 });
    expect(events).toEqual([{ type: 'phase', phase: 'vad' }, { type: 'progress', progress: 0.5, etaMs: 60000 }]);
  });

  it('shell errors become PlatformError with the speech codes', async () => {
    respond = () => {
      throw { code: 'MODEL_NOT_DOWNLOADED', message: 'download the model first', data: { modelId: 'turbo' } };
    };
    const err = (await createSpeechBindings().info().catch((e: unknown) => e)) as PlatformError;
    expect(err).toBeInstanceOf(PlatformError);
    expect([err.code, err.data]).toEqual(['MODEL_NOT_DOWNLOADED', { modelId: 'turbo' }]);
  });
});
