// STUB (M0) → T-SYNC owns this file from wave 1: the class service (meta LWW, organisers, consent, own member file).
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { ClassDetail, ClassService } from './types/class';
import { DIR_NAMES } from '../core/model/dirs';

export function emptyClassDetail(classId: ClassId, me: { deviceId: string; memberId: string } = { deviceId: '', memberId: '' }): ClassDetail {
  return {
    classId,
    meta: {
      name: '', shortName: '', colour: '#8d8d86', icon: 'book-open', lecturer: null, term: null, language: 'auto', description: null,
      vocabulary: null, askBeforeAdmit: false, largeClassAck: false, dirs: { ...DIR_NAMES.en },
    },
    organisers: [], people: [], unverified: [], me: { ...me, isOrganiser: false }, shared: false, readOnly: false, newerItems: 0,
  };
}

export function createClassService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ClassService {
  void app;
  const identity = ctx.identity.get();
  const device = ctx.device.get();
  return {
    detail: constant(emptyClassDetail(cls.classId, { deviceId: device?.deviceId ?? '', memberId: identity?.memberId ?? '' })),
    setMeta: () => Promise.reject(notImplemented('ClassService.setMeta')),
    setOrganiser: () => Promise.reject(notImplemented('ClassService.setOrganiser')),
    becomeOrganiser: () => Promise.reject(notImplemented('ClassService.becomeOrganiser')),
    refreshOwnMemberFile: () => Promise.reject(notImplemented('ClassService.refreshOwnMemberFile')),
    consent: {
      record: () => Promise.reject(notImplemented('ClassService.consent.record')),
      revoke: () => Promise.reject(notImplemented('ClassService.consent.revoke')),
      active: () => [],
    },
  };
}
