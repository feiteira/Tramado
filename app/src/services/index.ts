// createServices(ctx): wires every factory (architecture §11.2) and routes platform events to the class
// stores (§12). Frozen after M0: every factory lives in its own file owned by one work package.
import { PlatformError } from '../core/errors';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import { createClassStore, type ClassStoreImpl } from './classStore';
import { createLibrary, type ClassLibraryImpl } from './library';
import { createSyncService } from './sync';
import { createAiService } from './ai';
import { createSearchService } from './search';
import { createExtractionService } from './extraction';
import { createModelsService } from './models';
import { createRecordingService } from './recording';
import { createTranscriptionQueue } from './transcription';
import { createNotificationService } from './notifications';
import { createClassService } from './class';
import { createLectureService } from './lectures';
import { createDocumentService } from './documents';
import { createNotesService } from './notes';
import { createAnnotationService } from './annotations';
import { createExamService } from './exams';
import { createAskService } from './ask';
import { createChatService } from './chat';
import { createPresenceService } from './presence';
import { createClaimEngine } from './claims';
import { createTrustService } from './trust';
import type { AppServices, ClassServices } from './types/common';

export type { AppServices, ClassServices };

export interface AppServicesImpl extends AppServices {
  library: ClassLibraryImpl;
  /** Stops every class store and unsubscribes the event router (tests, phase changes). */
  dispose(): void;
}

export function createServices(ctx: AppContext): AppServicesImpl {
  const perClass = new Map<ClassId, ClassServices & { store: ClassStoreImpl }>();
  // eslint-disable-next-line prefer-const
  let services: AppServicesImpl;
  const app = () => services;
  const library = createLibrary(ctx, app);

  const forClass = (classId: ClassId): ClassServices => {
    const hit = perClass.get(classId);
    if (hit) return hit;
    const entry = library.entry(classId);
    if (!entry) throw new PlatformError('NOT_FOUND', `class ${classId} is not in the library`);
    const store = createClassStore(ctx, entry);
    const cls = { store, classId };
    const trust = createTrustService(ctx, app, cls);
    if (entry.shared) store.setTrustGate(trust);
    const created = {
      store,
      info: createClassService(ctx, app, cls),
      lectures: createLectureService(ctx, app, cls),
      documents: createDocumentService(ctx, app, cls),
      notes: createNotesService(ctx, app, cls),
      annotations: createAnnotationService(ctx, app, cls),
      exams: createExamService(ctx, app, cls),
      ask: createAskService(ctx, app, cls),
      chat: createChatService(ctx, app, cls),
      presence: createPresenceService(ctx, app, cls),
      claims: createClaimEngine(ctx, app, cls),
      trust,
    };
    perClass.set(classId, created);
    void store.start().catch((e: unknown) => ctx.log('error', 'class store failed to start', { classId, error: String(e) }));
    return created;
  };

  // Classes that left the library stop their store (and the lecture fold timers); the others get the reloaded
  // registry entry, so `store.state.entry` follows sharing (and a class shared later gets its trust gate). G1.
  const offLibrary = library.classes.subscribe(() => {
    const ids = new Set(library.classes.get().map((c) => c.id));
    for (const [id, s] of perClass) {
      if (!ids.has(id)) {
        s.store.stop();
        (s.lectures as { dispose?(): void }).dispose?.();
        perClass.delete(id);
        continue;
      }
      const e = library.entry(id);
      if (!e) continue;
      if (e.shared && !s.store.state.get().entry.shared) s.store.setTrustGate(s.trust);
      s.store.setEntry(e);
    }
  });

  // Event router (§12): class:changed and remoteChange → ClassStore.ingest (+ TrustService.noteRemote).
  const offChanged = ctx.platform.events.onClassChanged((e) => {
    perClass.get(e.classId)?.store.ingest(e.paths, { selfWrite: e.selfWrite, rescan: e.rescan });
  });
  const offSync = ctx.platform.events.onSync((e) => {
    if (e.type !== 'remoteChange') return;
    const s = perClass.get(e.classId);
    if (!s) return;
    s.trust.noteRemote(e.path, e.modifiedBy, ctx.clock.mono());
    s.store.ingest([e.path], { selfWrite: false, rescan: false });
  });

  services = {
    ctx,
    library,
    sync: createSyncService(ctx, app),
    ai: createAiService(ctx, app),
    search: createSearchService(ctx, app),
    models: createModelsService(ctx, app),
    recording: createRecordingService(ctx, app),
    transcription: createTranscriptionQueue(ctx, app),
    notifications: createNotificationService(ctx, app),
    extraction: createExtractionService(ctx, app),
    forClass,
    dispose() {
      offLibrary();
      offChanged();
      offSync();
      for (const s of perClass.values()) {
        s.store.stop();
        (s.lectures as { dispose?(): void }).dispose?.();
      }
      perClass.clear();
    },
  };
  return services;
}
