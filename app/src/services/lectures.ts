// STUB (M0) → T-LECTURES owns this file from wave 1: lectures, transcripts, markers, sharing and export.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { LectureService } from './types/lectures';

export function createLectureService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): LectureService {
  void ctx; void app; void cls;
  const no = (m: string) => () => Promise.reject(notImplemented(`LectureService.${m}`));
  return {
    list: constant([]),
    open: () => constant(null),
    rename: no('rename'), markDuplicate: no('markDuplicate'), deleteLecture: no('deleteLecture'), deleteAudio: no('deleteAudio'),
    markers: { add: no('markers.add'), remove: no('markers.remove'), removeAuto: no('markers.removeAuto') },
    share: no('share'), exportTranscript: no('exportTranscript'),
  };
}
