// What on-device transcription hands back (see platform/types.ts for the device side).

/** A timed piece of a transcript, in milliseconds from the start of the recording. */
export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
}

export interface SpeechTrack {
  segments: SpeechSegment[];
  /** The language the model heard (ISO 639-1), when it was left to tell. */
  language: string | null;
}

/** A finished transcription: one track, or two for a call recorded by Trama (mic, computer). */
export interface Transcription {
  tracks: SpeechTrack[];
  /** The recording's length in milliseconds. */
  duration: number;
  engine: string;
}
