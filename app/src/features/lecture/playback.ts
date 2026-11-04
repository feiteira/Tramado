// Where the lecture's audio plays from (UX §3.5.2, architecture §8, plan §15 item 7):
// - the browser demo has no real audio: a FakeMedia (demo/fakeMedia.ts) drives the same PlayerHandle;
// - Linux (WebKitGTK, AppInfo.mediaAudio 'blob') cannot play the tramado-media scheme in <audio>: the bytes are
//   read and played from a Blob URL;
// - elsewhere the scheme URL plays directly, and a MEDIA_ERR_SRC_NOT_SUPPORTED falls back to a Blob URL
//   silently (D21), noted in the log for the diagnostics.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClassId, ClassPath } from '../../core/model/ids';
import type { AppInfo } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { LectureDetail } from '../../services/types/lectures';
import { createFakeMedia, type FakeMedia } from '../../demo/fakeMedia';

export interface Playback {
  /** The URL for <audio> (null while it is being prepared, or with `media`). */
  src: string | null;
  /** The simulated engine (demo). */
  media: FakeMedia | null;
  /** Down-mix to mono while playing (stereo online recordings). */
  downmix: boolean;
  onMediaError(code: number): void;
}

const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export function useAppInfo(services: AppServices): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(services.ctx.info ?? null);
  useEffect(() => {
    if (info) return;
    let live = true;
    void services.ctx.platform.info().then((i) => live && setInfo(i), () => undefined);
    return () => {
      live = false;
    };
  }, [services, info]);
  return info;
}

export function usePlayback(services: AppServices, classId: ClassId, detail: LectureDetail | null, audioPath: ClassPath | null): Playback {
  const info = useAppInfo(services);
  const platform = services.ctx.platform;
  const demo = info?.os === 'web';
  const audioUrl = detail?.audioUrl ?? null;
  const durationMs = detail?.lecture.durationMs ?? 0;
  const channels = detail?.lecture.audio?.channels ?? 1;
  const isPrivate = !!detail?.lecture.audio && !detail.lecture.audio.shared;
  const [blob, setBlob] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const made = useRef<string | null>(null);

  const media = useMemo(() => (demo && audioUrl && durationMs > 0 ? createFakeMedia(durationMs) : null), [demo, audioUrl, durationMs]);
  useEffect(() => () => media?.dispose(), [media]);

  const wantBlob = !demo && !!audioUrl && (info?.mediaAudio === 'blob' || fallback);
  useEffect(() => {
    if (!wantBlob || !audioUrl) return undefined;
    let live = true;
    const make = async (): Promise<string> => {
      if (!isPrivate && audioPath) return platform.media.blobUrl(classId, audioPath, 'audio/webm');
      // A recording kept on this computer ("transcript only") is served under /r/<id>.webm: read it through fetch.
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`media ${res.status}`);
      return URL.createObjectURL(await res.blob());
    };
    make().then(
      (url) => {
        if (!live) {
          URL.revokeObjectURL(url);
          return;
        }
        made.current = url;
        setBlob(url);
      },
      (e: unknown) => platform.log('warn', 'media: the Blob fallback failed', { classId, error: String(e) }),
    );
    return () => {
      live = false;
      if (made.current) URL.revokeObjectURL(made.current);
      made.current = null;
      setBlob(null);
    };
  }, [wantBlob, audioUrl, audioPath, isPrivate, classId, platform]);

  return {
    src: media ? null : wantBlob ? blob : audioUrl,
    media,
    downmix: channels === 2,
    onMediaError(code) {
      if (code === MEDIA_ERR_SRC_NOT_SUPPORTED && !fallback && !demo) {
        platform.log('info', 'media: the scheme URL was refused, playing from a Blob URL', { classId });
        setFallback(true);
      }
    },
  };
}
