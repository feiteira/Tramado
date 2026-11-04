// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
import type { ClaimFile, ClassId, ClassPath, ErrorCode, Hex64, Instant, Lang, PickToken, Ulid } from './common';
import type { MarkerKind } from '../../core/model/files';

export type { MarkerKind };
export type ModelId = 'turbo' | 'small' | 'large-v3';
export interface ModelState {
  id: ModelId; file: string; size: number; sha256: Hex64; tier: 'default' | 'draft' | 'advanced'; recommended: boolean;
  state: 'absent' | 'partial' | 'downloading' | 'verifying' | 'ready' | 'failed'; bytes: number; error: ErrorCode | null;
  speedRT: number | null;                   // × real time measured by the last local job (member file caps.localModel.speedRT)
}
export interface SpeechInfo {
  cpuOk: boolean; localWhisper: boolean; vad: boolean; engineVersion: string;   // "whisper.cpp 1.8.3"
  defaultModel: ModelId; models: ModelState[];
  systemAudio: { supported: boolean; reason: ErrorCode | null };
  recorder: RecorderStatus | null; jobs: JobSummary[];
}
export interface AudioDevices { inputs: Array<{ id: string; name: string; isDefault: boolean }>; systemAudio: { supported: boolean; reason: ErrorCode | null } }
// MarkerKind = 'important' | 'confused' | 'exam' | 'todo' | 'note' — imported from core/model/files.ts (§1.2), not redeclared
export interface Marker { id: Ulid; atMs: number; rawMs: number; kind: MarkerKind; note?: string }
export interface MeterRequest { inputDeviceId: string | null; mode: 'room' | 'online' }
export interface RecorderStartRequest {
  recordingId: Ulid;                        // becomes the lecture id (draftId in presence)
  classId: ClassId; title: string; mode: 'room' | 'online'; includeMic: boolean;
  inputDeviceId: string | null; language: Lang | 'auto'; bitrate: 16000 | 24000 | 32000;
  markerOffsetMs: number;                   // reflex offset, default 3000 (at = raw − offset)
}
export interface TrackLevel { peak: number; rmsDb: number; clipping: boolean; device: string | null; error: ErrorCode | null; silentForMs: number }
export interface RecorderStatus {
  recordingId: Ulid; classId: ClassId; state: 'recording' | 'paused' | 'stopping'; ms: number;
  tracks: { mic: TrackLevel | null; system: TrackLevel | null }; bytesWritten: number; diskFree: number | null; markers: number;
}
export interface FinishedRecording {
  recordingId: Ulid; classId: ClassId; title: string; mode: 'room' | 'online'; language: Lang | 'auto';
  startedAt: Instant; durationMs: number; channels: 1 | 2; bitrate: number;
  speakers: Array<{ index: number; speaker: 'lecture' | 'me' | 'class' }>;
  pauses: Array<{ atMs: number; wallFrom: Instant; wallTo: Instant }>;
  markers: Marker[]; state: 'stopped' | 'recovered'; recoveredLostMs: number | null;
  // Additive (R-SPEECH): the audio was already published or imported, but its lecture.json was not written yet
  // (the webview went away in between): write the manifest from this instead of publishing again.
  audio?: PublishedAudio;
  import?: ImportInfo;                      // an imported file (lecture.json mode "import", import{…})
}
// Additive (R-SPEECH): lecture.json `import` (folder spec §8.6) plus the lecture directory the audio went to.
export interface ImportInfo { fileName: string; mime: string; hadVideo: boolean; lectureDir: ClassPath }
export type AudioSource = { kind: 'class'; classId: ClassId; path: ClassPath } | { kind: 'private'; recordingId: Ulid };
export type ShareMode = 'audio+transcript' | 'transcript-only' | 'none';
export interface PublishRequest { recordingId: Ulid; classId: ClassId; lectureDir: ClassPath; share: ShareMode }
  // 'transcript-only': the WebM stays at data/recordings/<id>.webm (AudioSource private) and lecture.json has audio.shared:false;
  // 'none': nothing is written to the class; the recording stays in speech_recordings_pending until a share mode is chosen
export interface PublishedAudio { source: AudioSource; size: number; sha256: Hex64; durationMs: number; channels: 1 | 2; bitrate: number; sampleRate: 16000 }
export interface ImportAudioRequest { recordingId: Ulid; pick: PickToken; classId: ClassId; lectureDir: ClassPath; keepVideo: boolean }
export interface TranscribeRequest {
  jobId: string; lectureId: Ulid; source: AudioSource; expectSha256: Hex64;
  engine: { kind: 'local'; model: ModelId } | { kind: 'cloud'; model: string };   // Rust TranscribeEngine, tag "kind"
  language: Lang | 'auto'; channels: 'mix' | 'split';
  initialPrompt: string | null;                                          // class vocabulary (meta `vocabulary`, ≤ 500 chars)
  claim: { classId: ClassId; path: ClassPath; file: ClaimFile } | null;   // Rust rewrites it every 60 s (heartbeat+1, progress, etaMs, updatedAt)
  resume: boolean;                                                       // continue from data/transcribe/<lectureId>.partial.json
}
export interface JobSummary {
  jobId: string; lectureId: Ulid; state: 'running' | 'done' | 'failed' | 'cancelled';
  progress: number; etaMs: number | null; startedAt: Instant; error: ErrorCode | null; resultReady: boolean;
}
export interface TranscriptionResult {
  lectureId: Ulid; durationMs: number; language: string;
  engine: { kind: 'local' | 'cloud'; name: string; version?: string; model?: string; modelSha256?: Hex64; vad?: string };
  tracks: Array<{ speaker: 'lecture' | 'me' | 'class'; segments: Array<{ startMs: number; endMs: number; text: string;
                  words?: Array<{ startMs: number; endMs: number; text: string; p: number }> }> }>;
}


// ── Architecture §7.2 (verbatim) ──
export type ModelEvent =
  | { type: 'started'; total: number; resumedFrom: number }
  | { type: 'progress'; done: number; total: number; bytesPerSec: number }      // ≤ 4 Hz
  | { type: 'verifying' }
  | { type: 'done'; model: ModelState }
  | { type: 'failed'; code: ErrorCode; message: string }
  | { type: 'cancelled' };

export type RecorderEvent =
  | { type: 'status'; status: RecorderStatus }                                  // 10 Hz
  | { type: 'warning'; code: 'silentMic' | 'lowDisk' | 'lowBattery' | 'deviceLost' }
  | { type: 'marker'; marker: Marker }                                          // also from the global shortcut
  | { type: 'stopped'; reason: 'user' | 'error' | 'diskFull'; code?: ErrorCode };

export type TranscribeEvent =
  | { type: 'phase'; phase: 'checking' | 'decoding' | 'vad' | 'transcribing' | 'uploading' }
  | { type: 'progress'; progress: number; etaMs: number | null }               // ≤ 1 Hz; also written to the claim
  | { type: 'done'; summary: JobSummary }                                      // result ready: speech_transcribe_take
  | { type: 'failed'; code: ErrorCode; message: string }
  | { type: 'cancelled' };

export type ImportEvent =
  | { type: 'progress'; done: number }                                          // 0..1
  | { type: 'done'; audio: PublishedAudio }
  | { type: 'failed'; code: ErrorCode; message: string };

export type MeterEvent = { type: 'level'; mic: TrackLevel | null; system: TrackLevel | null };   // 10 Hz
