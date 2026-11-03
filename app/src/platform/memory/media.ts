// Media URLs of the memory platform: `blob:` URLs of the in-memory bytes (the demo's mediaBase is 'blob:'),
// and the bundled demo audio for the self-test. Pure from the caller's point of view (architecture §8).
import { PlatformError } from '../../core/errors';
import type { ClassId, ClassPath } from '../../core/model/ids';
import type { AudioSource } from '../types';
import type { FileStore } from './files';

const MIME: Record<string, string> = {
  webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  flac: 'audio/flac', mp4: 'video/mp4', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', md: 'text/plain', vtt: 'text/plain',
};
export const mimeOfPath = (p: string): string => MIME[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

export function createMedia(deps: { files: () => FileStore; recordings: Map<string, Uint8Array>; selftestUrl: string }) {
  const urls = new Map<string, { url: string; bytes: Uint8Array }>();
  const objectUrl = (key: string, bytes: Uint8Array, mime: string): string => {
    const hit = urls.get(key);
    if (hit && hit.bytes === bytes) return hit.url;
    if (hit && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(hit.url);
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : `blob:memory/${encodeURIComponent(key)}`;
    urls.set(key, { url, bytes });
    return url;
  };
  const classBytes = (classId: ClassId, path: ClassPath): Uint8Array => {
    const f = deps.files().raw(classId).files.get(path);
    if (!f) throw new PlatformError('NOT_FOUND', `no file ${path}`);
    return f.bytes;
  };
  return {
    url(source: AudioSource | { kind: 'file'; classId: ClassId; path: ClassPath } | { kind: 'selftest' }): string {
      if (source.kind === 'selftest') return deps.selftestUrl;
      if (source.kind === 'private') {
        const b = deps.recordings.get(source.recordingId);
        if (!b) throw new PlatformError('NOT_FOUND', 'no such recording');
        return objectUrl(`r/${source.recordingId}`, b, 'audio/webm');
      }
      return objectUrl(`c/${source.classId}/${source.path}`, classBytes(source.classId, source.path), mimeOfPath(source.path));
    },
    async blobUrl(classId: ClassId, path: ClassPath, mime: string): Promise<string> {
      const bytes = classBytes(classId, path);
      return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : `blob:memory/${encodeURIComponent(path)}`;
    },
  };
}
