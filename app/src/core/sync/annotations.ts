// Annotation lines (folder spec §8.17): the same line shape for private annotations (app data) and shared ones
// (v1.1). Edit/delete rules are chat's: only the author's person; the greatest HLC edit wins; delete is final.
// Pure fold shared by AnnotationService (T-DOCS) and, from v1.1, the shared annotation reader.
import { isHlc, isUlid, type DeviceId, type Hlc, type MemberId, type Ulid } from '../model/ids';
import type { AnnotationLine } from '../model/files';

export interface AnnotationSource { deviceId: DeviceId; line: AnnotationLine; seq: number }

export interface FoldedAnnotation {
  id: Ulid;
  deviceId: DeviceId;
  author: MemberId | null;
  unverified: boolean;
  add: AnnotationLine;
  body: string | undefined;
  edited: boolean;
  hlc: Hlc;
}

export function annotationLineOk(l: unknown): l is AnnotationLine {
  if (typeof l !== 'object' || l === null) return false;
  const o = l as Record<string, unknown>;
  if (!isUlid(o.id) || !isUlid(o.annotationId) || !isHlc(o.hlc)) return false;
  if (o.type === 'add') return (o.kind === 'comment' || o.kind === 'highlight') && typeof o.target === 'object' && o.target !== null;
  return o.type === 'edit' || o.type === 'delete';
}

export function foldAnnotations(lines: readonly AnnotationSource[], personAt: (deviceId: DeviceId, hlc: Hlc) => MemberId | null): FoldedAnnotation[] {
  const sorted = [...lines].sort((a, b) => (a.line.hlc < b.line.hlc ? -1 : a.line.hlc > b.line.hlc ? 1 : a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.seq - b.seq));
  const byId = new Map<string, FoldedAnnotation & { deleted: boolean; editHlc: Hlc | null }>();
  const pending: AnnotationSource[] = [];
  for (const s of sorted) {
    if (s.line.type !== 'add') {
      pending.push(s);
      continue;
    }
    const key = `${s.deviceId}:${s.line.annotationId}`;
    if (byId.has(key)) continue;
    const author = personAt(s.deviceId, s.line.hlc);
    byId.set(key, {
      id: s.line.annotationId, deviceId: s.deviceId, author, unverified: author === null || author !== s.line.memberId, add: s.line,
      body: s.line.body, edited: false, hlc: s.line.hlc, deleted: false, editHlc: null,
    });
  }
  for (const s of pending) {
    // An edit/delete addresses an annotation of the same person, in any of that person's devices' files.
    const actor = personAt(s.deviceId, s.line.hlc);
    if (!actor) continue;
    for (const a of byId.values()) {
      if (a.id !== s.line.annotationId || a.author !== actor) continue;
      if (s.line.type === 'delete') a.deleted = true;
      else if (!a.deleted && (a.editHlc === null || s.line.hlc > a.editHlc)) {
        a.editHlc = s.line.hlc;
        a.body = s.line.body;
        a.edited = true;
      }
    }
  }
  return [...byId.values()].filter((a) => !a.deleted).map(({ deleted: _d, editHlc: _e, ...rest }) => rest);
}
