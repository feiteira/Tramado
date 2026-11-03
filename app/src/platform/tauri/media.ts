// The `tramado-media` scheme (architecture §8): URLs are built here, purely; the Blob-URL fallback
// reads the bytes with class_read.
import type { Platform } from '../types';
import { call, toBytes } from './index';

const enc = (segments: string) => segments.split('/').map(encodeURIComponent).join('/');

/** Base URL per OS: Linux and macOS use the custom scheme, Windows the http alias. */
export function mediaBase(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Windows/i.test(ua) ? 'http://tramado-media.localhost' : 'tramado-media://localhost';
}

export function createMediaBindings(base: string = mediaBase()): Platform['media'] {
  return {
    url(source) {
      switch (source.kind) {
        case 'selftest':
          return `${base}/res/selftest.webm`;
        case 'private':
          return `${base}/r/${encodeURIComponent(source.recordingId)}.webm`;
        case 'class':
        case 'file':
          return `${base}/c/${encodeURIComponent(source.classId)}/${enc(source.path)}`;
      }
    },
    async blobUrl(classId, path, mime) {
      const bytes = toBytes(await call<ArrayBuffer>('class_read', { classId, path }));
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    },
  };
}
