// AiService (architecture §11.2): AI settings (key status, privacy level, model and fallbacks, custom host, busy
// policy, answer language), the AiClient over `platform.ai`, the free-request quota (`GET key`, 5 min cache), the
// model catalog (`GET models`, 24 h cache in `cache/models-catalog.json`, critique G21) and request estimates (G11).
// It also exports the storage → view mappings of AI answers shared by exams, Ask and chat (UX §3.9.1, §4.1).
import { PlatformError, errorCode, toPlatformError } from '../core/errors';
import { createAiClient, type AiClient, type ClientSettings, type RunOptions, type RunResult } from '../core/ai/client';
import { CATALOG_KEY, createCatalog, isFresh, levelsOf, modelBusy, modelLabel, parseModels, readCatalogCache, validateChain, type Catalog, type CatalogCache } from '../core/ai/catalog';
import { chainFor, defaultFallbacks, DEFAULT_MODEL } from '../core/ai/defaults';
import { estimateRequests } from '../core/ai/cost';
import { grounding, isInsufficient, parseCitations } from '../core/ai/citations';
import { catalogs } from '../core/i18n/catalogs';
import type { Citation, Locator, SourceRef } from '../core/model/files';
import type { ClassId, DeviceId, MemberId } from '../core/model/ids';
import type { AiHost, ConfirmText, PrivacyLevel, SecretStatus } from '../platform/types';
import { Store } from './store';
import type { AppContext, CatalogModel } from './context';
import type { AppServices } from './types/common';
import type { AiService, AiSettingsExtra, AiSettingsView } from './types/ai';
import type { AiAnswerView, DeviceRef, ModelLabel, Quota, ViewCitation, ViewLocator, ViewSourceRef } from './types/viewModels';

export const QUOTA_TTL_MS = 5 * 60_000;

type Settings = AiSettingsView & { enabled: boolean; busyRelax: boolean; generalDefault: boolean } & AiSettingsExtra;

/** The local ISO time (with offset) of an epoch, e.g. "2026-11-05T00:00:00+00:00" (UX `Quota.resetsAt`). */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const p = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

/** The next 00:00 UTC after `nowMs` (free requests reset then, critique D10). */
export const nextUtcMidnight = (nowMs: number): number => (Math.floor(nowMs / 86_400_000) + 1) * 86_400_000;

/** `GET key` → the UX Quota (null when the body has no free-request counter). */
export function quotaFromKey(body: unknown, nowMs: number): Quota | null {
  const d = ((body ?? {}) as { data?: Record<string, unknown> }).data ?? {};
  const f = d.free_model_daily_requests as { used?: unknown; limit?: unknown; remaining?: unknown } | undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  if (!f) return null;
  const limit = n(f.limit);
  const used = n(f.used);
  const remaining = n(f.remaining) ?? (limit !== null && used !== null ? Math.max(0, limit - used) : null);
  if (limit === null || remaining === null) return null;
  return {
    remaining, limit, used: used ?? Math.max(0, limit - remaining), resetsAt: localIso(nextUtcMidnight(nowMs)),
    isFreeTier: d.is_free_tier === true || d.is_free_tier === 'true', creditLeft: n(d.limit_remaining),
  };
}

/** The UI locale's catalog (prefs `ui.locale`; '' = English until the shell detects it). */
function messages(ctx: AppContext) {
  const l = ctx.prefs.get('ui.locale');
  return catalogs[(l === 'pt' || l === 'es' ? l : 'en') as 'en'];
}

export function createAiService(ctx: AppContext, app: () => AppServices): AiService {
  void app;
  const { platform } = ctx;
  let privacy: PrivacyLevel = 'no-training';
  let busyRelax = false;
  let key: SecretStatus = { set: false, last4: null, store: 'memory' };
  let hosts: AiHost[] = [];
  let catalogCache: CatalogCache | null = null;
  let catalog: Catalog | null = null;
  let quota: { value: Quota; at: number } | null = null;
  let lastAnswer: ModelLabel | null = null;

  const prefsFallbacks = (): string[] => {
    try {
      const v = JSON.parse(ctx.prefs.get('ai.fallbacks')) as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const customHostId = (): string | null => {
    const id = ctx.prefs.get('ai.customHost');
    return id ? id : null;
  };
  const label = (id: string): ModelLabel => {
    const c = catalog?.get(id);
    return { id, label: c ? c.label : modelLabel(id), free: c ? c.free : id.endsWith(':free') };
  };

  /** The chain the client uses: the user's model and fallbacks, checked against the catalog (critique G21). */
  function effective(): { chain: string[]; fallbacks: string[]; replaced: Settings['replaced'] } {
    const model = ctx.prefs.get('ai.model') || DEFAULT_MODEL;
    if (customHostId()) return { chain: [model], fallbacks: [], replaced: null };
    const fallbacks = prefsFallbacks();
    const chain = chainFor(privacy, model, fallbacks);
    const v = validateChain(chain, catalog, privacy);
    return {
      chain: v.chain.length ? v.chain : chain,
      fallbacks: fallbacks.length ? fallbacks : defaultFallbacks(privacy, model),
      replaced: v.replacement ? { model, replacement: v.replacement } : null,
    };
  }

  function view(): Settings {
    const eff = effective();
    const hostId = customHostId();
    const now = ctx.clock.now();
    return {
      key, privacy, model: ctx.prefs.get('ai.model') || DEFAULT_MODEL, fallbacks: eff.fallbacks, chain: eff.chain,
      customHost: hostId ? hosts.find((h) => h.id === hostId) ?? { id: hostId, base: '', label: hostId } : null,
      answerLanguage: ctx.prefs.get('ai.answerLanguage') === 'ui' ? 'ui' : 'question',
      quota: hostId ? null : quota?.value ?? null,
      catalogAge: catalogCache ? Math.max(0, now - catalogCache.fetchedAt) : null,
      lastAnswerModel: lastAnswer,
      enabled: ctx.prefs.get('ai.enabled') !== '0', busyRelax, generalDefault: ctx.prefs.get('ai.generalDefault') === '1',
      replaced: eff.replaced,
      freeAtLevel: catalog ? catalog.views().filter((m) => m.free && m.levels.includes(privacy)).length : null,
    };
  }
  const settings = new Store<Settings>(view());
  const refresh = () => settings.set(view());
  ctx.prefs.store.subscribe(refresh);

  const clientSettings = (): ClientSettings => {
    const eff = effective();
    return { level: privacy, model: eff.chain[0] ?? DEFAULT_MODEL, fallbacks: eff.chain.slice(1), customHost: customHostId(), busyRelax };
  };
  const base = createAiClient({
    transport: platform.ai, clock: ctx.clock, rand: ctx.rand, settings: clientSettings, catalog: () => catalog,
    onAnswered: (r: RunResult) => {
      lastAnswer = label(r.model);
      refresh();
    },
  });
  const busyText = (): ConfirmText => {
    const m = messages(ctx);
    return { title: m.ai.busy.once, message: m.ai.busy.footnote, confirm: m.ai.privacy.standardConfirm, cancel: m.common.cancel };
  };
  /** The client the services use: refuses while AI is off, and fills the native confirmation of the busy chooser. */
  const client: AiClient = {
    async run(o: RunOptions) {
      await ready;
      if (ctx.prefs.get('ai.enabled') === '0') throw new PlatformError('AI_NO_KEY', 'AI is turned off on this computer', { disabled: true });
      return base.run(o.busyFallback && !o.overrideText ? { ...o, overrideText: busyText() } : o);
    },
    async get(path, activity) {
      await ready;
      return base.get(path, activity);
    },
    settings: base.settings,
    throttle: base.throttle,
  };

  async function loadCatalogCache() {
    try {
      catalogCache = readCatalogCache(await platform.cache.read(CATALOG_KEY));
      catalog = catalogCache ? createCatalog(catalogCache) : null;
    } catch (e) {
      ctx.log('warn', 'AI catalog cache unreadable', { error: String(e) });
    }
  }

  const ready: Promise<void> = (async () => {
    const results = await Promise.allSettled([
      platform.secrets.status('openrouter').then((s) => (key = s)),
      platform.ai.privacy().then((p) => (privacy = p)),
      platform.ai.busyPolicy().then((b) => (busyRelax = b)),
      platform.ai.hosts().then((h) => (hosts = h)),
      loadCatalogCache(),
    ]);
    for (const r of results) if (r.status === 'rejected') ctx.log('warn', 'AI settings could not be read', { error: String(r.reason) });
    refresh();
  })();
  // Start-up validation of the chain against the catalog (critique G21): in the background, once a key exists.
  const warmCatalog = () => {
    if (key.set && !customHostId() && ctx.prefs.get('ai.enabled') !== '0' && !isFresh(catalogCache, ctx.clock.now())) {
      void service.catalog().catch((e: unknown) => ctx.log('info', 'AI catalog not refreshed', { code: errorCode(e) }));
    }
  };
  void ready.then(warmCatalog);

  async function refreshQuota(): Promise<void> {
    await ready;
    if (customHostId()) return;
    const body = await client.get('key', { classId: null, action: 'keyCheck', passages: 0 });
    const q = quotaFromKey(body, ctx.clock.now());
    quota = q ? { value: q, at: ctx.clock.now() } : null;
    refresh();
  }

  const service: AiService = {
    settings,
    client,
    ready: () => ready,
    label,
    async setKey(value: string) {
      await ready;
      const v = value.trim();
      if (!/^\S{1,400}$/.test(v)) throw new PlatformError('INVALID', 'a key is 1–400 characters without spaces');
      key = await platform.secrets.set('openrouter', v);
      quota = null;
      refresh();
      warmCatalog();
    },
    async clearKey() {
      await ready;
      await platform.secrets.clear('openrouter');
      key = { ...key, set: false, last4: null };
      quota = null;
      refresh();
    },
    async testKey() {
      await ready;
      try {
        const body = await base.get('key', { classId: null, action: 'keyCheck', passages: 0 });
        const q = quotaFromKey(body, ctx.clock.now());
        if (q) quota = { value: q, at: ctx.clock.now() };
        key = await platform.secrets.status('openrouter').catch(() => key);
        refresh();
        // INT (UX §3.1 "OK but default busy"): the endpoints' recent uptime, a free GET (no request of the quota).
        let busy = false;
        const first = settings.get().chain[0];
        if (first && !first.includes('..') && /^[\w.-]+\/[\w.:-]+$/.test(first)) {
          busy = await base.get(`models/${first}/endpoints`, { classId: null, action: 'keyCheck', passages: 0 }).then((b) => modelBusy(b) === true, () => false);
        }
        return { ok: true, ...(q ? { remaining: q.remaining } : {}), ...(busy ? { busy: true } : {}) };
      } catch (e) {
        return { ok: false, code: errorCode(e) };
      }
    },
    async setModel(id: string) {
      if (!id.trim()) throw new PlatformError('INVALID', 'empty model id');
      await ctx.prefs.set('ai.model', id.trim());
      refresh();
    },
    async setFallbacks(ids: string[]) {
      const clean = [...new Set(ids.map((x) => x.trim()).filter(Boolean))].slice(0, 2);
      await ctx.prefs.set('ai.fallbacks', JSON.stringify(clean));
      refresh();
    },
    async setPrivacy(level: PrivacyLevel) {
      await ready;
      const m = messages(ctx);
      const text: ConfirmText = level === 'standard'
        ? { title: m.ai.privacy.standardConfirmTitle, message: m.ai.privacy.standardConfirmBody, confirm: m.ai.privacy.standardConfirm, cancel: m.common.cancel }
        : { title: m.ai.privacy.noTraining, message: m.ai.privacy.noTrainingHint, confirm: m.ai.privacy.standardConfirm, cancel: m.common.cancel };
      const ok = await platform.ai.setPrivacy(level, text);
      if (ok) privacy = await platform.ai.privacy().catch(() => level);
      refresh();
      return ok;
    },
    async setCustomHost(baseUrl: string | null) {
      await ready;
      if (baseUrl === null || baseUrl.trim() === '') {
        await ctx.prefs.set('ai.customHost', '');
        refresh();
        return;
      }
      const m = messages(ctx);
      const host = await platform.ai.allowHost(baseUrl.trim(), { title: m.ai.hostConfirm.title, message: m.ai.hostConfirm.body, confirm: m.ai.hostConfirm.confirm, cancel: m.common.cancel });
      if (!host) return;
      hosts = await platform.ai.hosts().catch(() => [...hosts.filter((h) => h.id !== host.id), host]);
      await ctx.prefs.set('ai.customHost', host.id);
      refresh();
    },
    async setEnabled(on: boolean) {
      await ctx.prefs.set('ai.enabled', on ? '1' : '0');
      refresh();
    },
    async setBusyPolicy(relax: boolean) {
      await ready;
      const m = messages(ctx);
      const ok = await platform.ai.setBusyPolicy(relax, { title: m.ai.busy.always, message: m.ai.busy.alwaysConfirm, confirm: m.ai.privacy.standardConfirm, cancel: m.common.cancel });
      if (ok) busyRelax = relax;
      refresh();
      return ok;
    },
    async setGeneralDefault(on: boolean) {
      await ctx.prefs.set('ai.generalDefault', on ? '1' : '0');
      refresh();
    },
    async refreshQuota() {
      await refreshQuota();
    },
    async catalog(): Promise<CatalogModel[]> {
      await ready;
      if (!isFresh(catalogCache, ctx.clock.now())) {
        try {
          const body = await base.get('models', { classId: null, action: 'catalog', passages: 0 });
          const data = parseModels(body);
          if (data.length) {
            catalogCache = { fetchedAt: ctx.clock.now(), data };
            catalog = createCatalog(catalogCache);
            await platform.cache.write(CATALOG_KEY, new TextEncoder().encode(JSON.stringify(catalogCache))).catch((e: unknown) => ctx.log('warn', 'catalog cache not written', { error: String(e) }));
          }
        } catch (e) {
          if (!catalog) throw toPlatformError(e);
          ctx.log('warn', 'AI catalog refresh failed; using the cached list', { code: errorCode(e) });
        }
        refresh();
      }
      return catalog ? catalog.views().map((v) => ({ ...v, levels: levelsOf(v) })) : [];
    },
    activity: (limit: number) => platform.ai.activity(limit),
    clearActivity: () => platform.ai.clearActivity(),
    estimate(task: string, count: number) {
      const q = quota && ctx.clock.now() - quota.at < 24 * 3600_000 ? quota.value : null;
      return { requests: estimateRequests(task, count), remaining: customHostId() ? null : q?.remaining ?? null };
    },
  };
  return service;
}

// ── Storage → view (UX §3.9.1, §4.1), shared by ExamService, AskService and the chat (T-SYNC) ───────────────────

/** Storage locator (folder spec §8.15) → view locator (UX §4.1). */
export function viewLocator(l: Locator): ViewLocator {
  switch (l.type) {
    case 'page': return { kind: 'page', page: l.page, ...(l.pageLabel ? { label: l.pageLabel } : {}) };
    case 'article': return { kind: 'article', label: l.article, page: l.pages?.[0] ?? 1, ...(l.pages && l.pages[1] !== l.pages[0] ? { pageEnd: l.pages[1] } : {}) };
    case 'slide': return { kind: 'slide', slide: l.slide };
    case 'segment': return { kind: 'time', ms: l.startMs, endMs: l.endMs, segmentId: l.segmentId };
    case 'heading': return { kind: 'heading', path: l.path };
    default: return { kind: 'none' };
  }
}

/** A source is private when it is a note outside the class's Notes folder (My notes; never shared, UX §3.11). */
export function isPrivateSource(src: SourceRef, classNotesDir: string): boolean {
  return src.kind === 'note' && !src.path.startsWith(`${classNotesDir}/`);
}

const baseNameNoExt = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/** Storage citations of an answer → numbered view citations (hallucinated refs included, struck through). */
export function viewCitations(text: string, cites: readonly Citation[], classId: ClassId, classNotesDir: string): ViewCitation[] {
  const byRef = new Map(cites.map((c) => [c.ref, c]));
  return parseCitations(text, new Set(byRef.keys())).chips.map((chip) => {
    const c = byRef.get(chip.ref);
    if (!c) return { n: chip.n, ref: chip.ref, pin: chip.pin, source: null, status: 'hallucinated' as const };
    const s = c.source;
    // UX §4.1: documents and notes are titled without their file extension (a label may carry ".pdf").
    const head = c.label.split(' · ')[0] ?? '';
    const title = (s.kind === 'document' || s.kind === 'note' ? head.replace(/\.(?:pdf|docx?|pptx?|odt|md|txt|png|jpe?g|webp)$/i, '') : head) || (s.kind === 'document' || s.kind === 'note' ? baseNameNoExt(s.path) : c.label);
    const src: ViewSourceRef = {
      type: s.kind, classId, title,
      ...(s.kind === 'document' || s.kind === 'note' ? { relPath: s.path, sha256: s.sha256 } : {}),
      ...(s.kind === 'lecture' ? { lectureId: s.lectureId } : {}),
      ...(s.kind === 'exam' ? { examId: s.examId } : {}),
      ...(isPrivateSource(s, classNotesDir) ? { private: true } : {}),
      locator: s.kind === 'exam' && s.questionId ? { kind: 'question', questionId: s.questionId, number: c.pin ?? '' } : viewLocator(c.locator),
      quote: c.quote ?? { exact: '', prefix: '', suffix: '' },
    };
    return { n: chip.n, ref: chip.ref, pin: chip.pin ?? c.pin ?? null, source: src, status: 'ok' as const };
  });
}

export interface AnswerLike {
  text: string; citations: Citation[]; model: string; requestedModel: string; at: string;
  generalKnowledge?: Array<[number, number]>; mode: 'quick' | 'deep' | 'hint'; scope?: 'materials' | 'materials+general';
}

/** An answer (shared answer, hint, chat `ai` line, Ask turn) → the UX AiAnswerView. */
export function answerView(a: AnswerLike, ctx: { classId: ClassId; notesDir: string; askedBy: DeviceRef; label: (id: string) => ModelLabel; sent?: { passages: number; chars: number } }): AiAnswerView {
  const text = a.text.trim();
  const citations = viewCitations(text, a.citations, ctx.classId, ctx.notesDir);
  const g = grounding(text, new Set(a.citations.map((c) => c.ref)), a.scope === 'materials+general' || !!a.generalKnowledge?.length);
  return {
    text, citations,
    unverified: a.generalKnowledge?.length ? a.generalKnowledge.map(([s, e]) => a.text.slice(s, e).trim()).filter(Boolean) : g.unverified,
    model: ctx.label(a.model), requested: ctx.label(a.requestedModel || a.model), fallback: !!a.requestedModel && a.model !== a.requestedModel,
    askedBy: ctx.askedBy, at: a.at, mode: a.mode, grounded: g.grounded,
    insufficient: isInsufficient(text) || (a.citations.length === 0 && a.scope !== 'materials+general'),
    sent: ctx.sent ?? { passages: new Set(a.citations.map((c) => c.ref)).size, chars: 0 },
  };
}

/** A DeviceRef from what the class knows of the device and its person (names may be unknown yet). */
export function deviceRef(app: () => AppServices, classId: ClassId, deviceId: DeviceId, memberId: MemberId, fallbackName: string, me: DeviceId | null): DeviceRef {
  let deviceName = '';
  let memberName = fallbackName;
  try {
    for (const p of app().forClass(classId).info.detail.get().people) {
      const d = p.devices.find((x) => x.deviceId === deviceId);
      if (d || p.memberId === memberId) {
        memberName = p.name || memberName;
        if (d) deviceName = d.deviceName;
      }
    }
  } catch {
    // the class service is not available (tests, a class being removed)
  }
  return { deviceId, deviceName, memberId, memberName, self: deviceId === me };
}
