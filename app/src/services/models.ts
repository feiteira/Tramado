// ModelsService (architecture §11.2): the local speech models of this computer — download with progress and
// re-attach after a reload, cancel (keeps the .part), delete, import from a file, and the active model
// (prefs `speech.model`). Without `platform.speech` (the browser demo without `speech=fake`) it is empty.
import { PlatformError, toPlatformError } from '../core/errors';
import type { ModelEvent, ModelId, ModelState, SpeechInfo } from '../platform/types';
import type { AppContext } from './context';
import { Store } from './store';
import type { AppServices } from './types/common';
import type { ModelsService } from './types/transcription';

const MODEL_IDS: readonly ModelId[] = ['turbo', 'small', 'large-v3'];
const asModelId = (v: string): ModelId => ((MODEL_IDS as readonly string[]).includes(v) ? (v as ModelId) : 'turbo');

export interface ModelsServiceImpl extends ModelsService {
  /** Resolves once the first `refresh` finished (tests). */
  ready(): Promise<void>;
}

export function createModelsService(ctx: AppContext, app: () => AppServices): ModelsServiceImpl {
  const { platform } = ctx;
  const models = new Store<ModelState[]>([]);
  const info = new Store<SpeechInfo | null>(null);
  const downloads = new Store<Partial<Record<ModelId, { done: number; total: number; bytesPerSec: number }>>>({});
  const active = new Store<ModelId>(asModelId(ctx.prefs.get('speech.model')));
  ctx.prefs.store.subscribe(() => active.set(asModelId(ctx.prefs.get('speech.model'))));
  const attached = new Set<ModelId>();

  const speech = () => {
    const s = platform.speech;
    if (!s) throw new PlatformError('INVALID', 'speech is not available in this build');
    return s;
  };
  const patch = (id: ModelId, p: Partial<ModelState>) => models.update((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const replace = (m: ModelState) => models.update((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
  const dropDownload = (id: ModelId) =>
    downloads.update((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  function onEvent(id: ModelId) {
    return (e: ModelEvent) => {
      switch (e.type) {
        case 'started':
          downloads.update((d) => ({ ...d, [id]: { done: e.resumedFrom, total: e.total, bytesPerSec: 0 } }));
          patch(id, { state: 'downloading', bytes: e.resumedFrom, error: null });
          break;
        case 'progress':
          downloads.update((d) => ({ ...d, [id]: { done: e.done, total: e.total, bytesPerSec: e.bytesPerSec } }));
          patch(id, { state: 'downloading', bytes: e.done });
          break;
        case 'verifying':
          patch(id, { state: 'verifying' });
          break;
        case 'done':
          attached.delete(id);
          dropDownload(id);
          replace(e.model);
          void Promise.resolve()
            .then(() => app().notifications.notify('model', 'notify.modelReady', {}, `model-${id}`))
            .catch(() => undefined);
          void refreshInfo();
          break;
        case 'failed':
          attached.delete(id);
          dropDownload(id);
          patch(id, { state: 'failed', error: e.code });
          break;
        case 'cancelled':
          attached.delete(id);
          dropDownload(id);
          patch(id, { state: 'partial' });
          break;
      }
    };
  }

  async function refreshInfo() {
    const s = platform.speech;
    if (!s) return;
    try {
      info.set(await s.info());
    } catch (e) {
      ctx.log('warn', 'speech info failed', { error: toPlatformError(e).message });
    }
  }

  async function refresh(): Promise<void> {
    const s = platform.speech;
    if (!s) {
      info.set(null);
      models.set([]);
      return;
    }
    await refreshInfo();
    const list = await s.models();
    models.set(list);
    // Re-attach downloads that kept running in Rust while the webview reloaded (D-7).
    for (const m of list) {
      if ((m.state === 'downloading' || m.state === 'verifying') && !attached.has(m.id)) {
        attached.add(m.id);
        const ok = await s.attachModel(m.id, onEvent(m.id)).catch(() => false);
        if (!ok) attached.delete(m.id);
      }
    }
  }

  const first = Promise.resolve().then(() => refresh()).catch((e: unknown) => ctx.log('warn', 'models: first refresh failed', { error: toPlatformError(e).message }));

  return {
    models,
    active,
    info,
    downloads,
    refresh,
    ready: () => first,
    async download(id) {
      const s = speech();
      attached.add(id);
      patch(id, { state: 'downloading', error: null });
      try {
        await s.downloadModel(id, onEvent(id));
      } catch (e) {
        attached.delete(id);
        const code = toPlatformError(e).code;
        patch(id, { state: code === 'JOB_BUSY' ? 'downloading' : 'failed', error: code === 'JOB_BUSY' ? null : code });
        throw e;
      }
    },
    async cancel(id) {
      await speech().cancelModel(id);
      dropDownload(id);
      patch(id, { state: 'partial' });
    },
    async remove(id) {
      await speech().deleteModel(id);
      await refresh();
    },
    async import(id, pick) {
      replace(await speech().importModel(id, pick.token));
      await refreshInfo();
    },
    async setActive(id) {
      if (!MODEL_IDS.includes(id)) throw new PlatformError('INVALID', `unknown model ${id}`);
      await ctx.prefs.set('speech.model', id);
      active.set(id);
    },
  };
}
