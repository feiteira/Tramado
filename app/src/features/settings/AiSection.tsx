// Settings › AI (UX §3.14.3, `[settings-ai]`): the service (OpenRouter or another OpenAI-compatible one), the OpenRouter
// key (status from the keychain — the key never comes back to the webview — or the field with [Paste] [Test and save]),
// the free-request quota (`GET /key` `free_model_daily_requests`), what providers may do with what is sent (`zdr` /
// `no-training` / `standard`; "standard" goes through the NATIVE confirmation), the model and its fallbacks, the busy
// policy ("Use NVIDIA free models" also asks natively), the answer language and the general-knowledge default, the
// custom service, Turn off AI, and the AI activity link.
import React, { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ClipboardPaste, ExternalLink, KeyRound, Power, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { AI_DEFAULTS, DEFAULT_MODEL } from '../../core/ai/defaults';
import type { ErrorCode } from '../../core/errors';
import type { PrivacyLevel } from '../../platform/types';
import type { CatalogModel } from '../../services/context';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Notice, Section } from '../../ui/components/Feedback';
import { Select, TextField } from '../../ui/components/Field';
import { useI18n } from '../../ui/i18n';
import { UI_LOCALE_META } from '../../core/i18n/languages';
import { QuotaMeter } from '../../ui/tramado/QuotaMeter';
import { useAiErrorText } from '../ask/AiErrorNotice';
import { useQuota } from '../ask/useQuota';
import '../ask/settings-ai.css';

/** The privacy radios map 1:1 to PrivacyLevel (UX §3.14.3; unit-checked). */
export const PRIVACY_LEVELS: readonly PrivacyLevel[] = ['zdr', 'no-training', 'standard'];
const KEY_PAGE = 'https://openrouter.ai/keys';

export default function AiSection({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { go } = useRouter();
  const confirm = useConfirm();
  const s = useStore(services.ai.settings);
  const errorText = useAiErrorText(services);
  useQuota(services, s.enabled && s.key.set && !s.customHost);
  const [service, setService] = useState<'openrouter' | 'custom'>(s.customHost ? 'custom' : 'openrouter');
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; code?: ErrorCode; remaining?: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [custom, setCustom] = useState({ address: s.customHost?.base ?? '', key: '', model: s.customHost ? s.model : '' });
  const [customResult, setCustomResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setService(s.customHost ? 'custom' : 'openrouter'), [s.customHost]);
  useEffect(() => {
    if (!s.key.set || s.customHost || !s.enabled) return;
    let live = true;
    void services.ai.catalog().then((c) => live && setCatalog(c)).catch(() => live && setCatalog([]));
    return () => {
      live = false;
    };
  }, [services, s.key.set, s.customHost, s.enabled, s.privacy]);

  const run = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await f();
    } catch (e) {
      const code = (e as { code?: ErrorCode }).code;
      setError(code ? errorText(code) : String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const testAndSave = () => run('check', async () => {
    if (key.trim()) await services.ai.setKey(key.trim());
    const r = await services.ai.testKey();
    setCheck(r);
    if (r.ok) {
      setKey('');
      setReplacing(false);
    }
  });
  const paste = () => run('paste', async () => {
    const text = await navigator.clipboard.readText();
    setKey(text.trim());
  });
  const removeKey = async () => {
    const ok = await confirm({ title: t('settings.ai.removeConfirm.title'), body: t('settings.ai.removeConfirm.body'), confirmLabel: t('settings.ai.removeConfirm.confirm'), danger: true, 'data-testid': 'ai-key-remove-confirm' });
    if (ok) await run('remove', async () => {
      await services.ai.clearKey();
      setCheck(null);
    });
  };

  const recommended = (AI_DEFAULTS.chains[s.privacy] ?? [])[0] ?? DEFAULT_MODEL;
  const freeAtLevel = (catalog ?? []).filter((m) => m.levels.includes(s.privacy));
  const modelOptions = useMemo(() => {
    const ids = new Set<string>([s.model, ...s.fallbacks, ...(catalog ?? []).filter((m) => m.levels.includes(s.privacy)).map((m) => m.id)]);
    const byId = new Map((catalog ?? []).map((m) => [m.id, m]));
    const rows = [...ids].map((id) => {
      const m = byId.get(id);
      const parts = [services.ai.label(id).label];
      if (m) parts.push(t('ai.models.context', { n: Math.round(m.context / 1000) }));
      if (m?.vision) parts.push(t('ai.models.vision'));
      const label = `${parts.join(' · ')}${id === recommended ? ` — ${t('ai.models.recommended')}` : ''}`;
      return { value: id, label, free: m ? m.free : id.endsWith(':free') };
    });
    return rows.sort((a, b) => Number(b.free) - Number(a.free) || (a.value === recommended ? -1 : b.value === recommended ? 1 : a.label.localeCompare(b.label)));
  }, [catalog, s.model, s.fallbacks, s.privacy, recommended, services, t]);
  const fallbackOptions = [{ value: '', label: t('common.none') }, ...modelOptions.map((o) => ({ value: o.value, label: services.ai.label(o.value).label }))];
  const fb = [s.fallbacks[0] ?? '', s.fallbacks[1] ?? ''];
  const modelFree = services.ai.label(s.model).free;
  const updated = s.catalogAge !== null ? i18n.relative(DateTime.fromMillis(services.ctx.clock.now() - s.catalogAge).toISO(), DateTime.fromMillis(services.ctx.clock.now())) : null;
  const uiLanguage = UI_LOCALE_META[i18n.locale].nativeName;

  const setPrivacy = (level: PrivacyLevel) => run('privacy', () => services.ai.setPrivacy(level));
  const setBusyPolicy = (relax: boolean) => run('busy', () => services.ai.setBusyPolicy(relax));

  return (
    <div className="settings-ai" data-testid="settings-ai">
      <h2 className="set-section__title">{t('settings.sections.ai')}</h2>
      <Section description={s.enabled ? undefined : t('settings.ai.offHint')}>
        {!s.enabled ? (
          <Notice tone="info" data-testid="ai-disabled" actions={<Button variant="primary" icon={Power} onClick={() => void run('on', () => services.ai.setEnabled(true))} data-testid="ai-on">{t('settings.ai.on')}</Button>}>
            {t('ai.pill.off')}
          </Notice>
        ) : null}
        <div className="sai__rows">
          <Row label={t('settings.ai.service')}>
            <RadioGroup
              label={t('settings.ai.service')}
              hideLabel
              variant="segmented"
              value={service}
              onChange={(v) => {
                setService(v);
                if (v === 'openrouter' && s.customHost) void run('service', () => services.ai.setCustomHost(null));
              }}
              options={[{ value: 'openrouter', label: t('settings.ai.openrouter') }, { value: 'custom', label: t('settings.ai.custom') }]}
              data-testid="ai-service"
            />
          </Row>

          {service === 'openrouter' ? (
            <>
              <Row label={t('settings.ai.key')}>
                {s.key.set && !replacing ? (
                  <div className="sai__key" data-testid="ai-key-status">
                    <span className="sai__key-text"><KeyRound size={14} aria-hidden /> {t('settings.ai.keySet', { last4: s.key.last4 ?? '····', store: t(s.key.store === 'file' ? 'settings.ai.storeFile' : 'settings.ai.storeKeychain') })}</span>
                    <span className="sai__buttons">
                      <Button size="sm" icon={RefreshCw} busy={busy === 'check'} onClick={() => void testAndSave()} data-testid="ai-key-test">{t('settings.ai.testAgain')}</Button>
                      <Button size="sm" onClick={() => setReplacing(true)} data-testid="ai-key-replace">{t('settings.ai.replace')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => void removeKey()} data-testid="ai-key-remove">{t('settings.ai.removeKey')}</Button>
                    </span>
                  </div>
                ) : (
                  <form className="sai__keyform" onSubmit={(e) => { e.preventDefault(); void testAndSave(); }}>
                    <TextField
                      label={t('settings.ai.key')}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      onChange={setKey}
                      placeholder="sk-or-…"
                      fieldClassName="sai__keyfield"
                      data-testid="ai-key"
                    />
                    <Button icon={ClipboardPaste} onClick={() => void paste()} data-testid="ai-key-paste">{t('settings.ai.paste')}</Button>
                    <Button type="submit" variant="primary" busy={busy === 'check'} disabled={!key.trim()} data-testid="ai-check">{t('settings.ai.test')}</Button>
                    {replacing ? <Button variant="ghost" onClick={() => { setReplacing(false); setKey(''); }}>{t('common.cancel')}</Button> : null}
                    <button
                      type="button"
                      className="sai__link"
                      onClick={() => void services.ctx.platform.system.openExternal(KEY_PAGE, { title: t('settings.ai.getKey'), message: KEY_PAGE, confirm: t('common.open'), cancel: t('common.cancel') }).catch(() => undefined)}
                      data-testid="ai-key-get"
                    >
                      {t('settings.ai.getKey')} <ExternalLink size={12} aria-hidden />
                    </button>
                  </form>
                )}
                {!s.key.set || replacing ? <p className="sai__hint">{t('settings.ai.age')}</p> : null}
                {check ? (
                  <Notice tone={check.ok ? 'success' : 'danger'} data-testid="ai-check-result">
                    {check.ok ? (check.remaining !== undefined ? tp('settings.ai.checkOk', check.remaining, { n: check.remaining }) : t('common.done')) : errorText(check.code ?? 'AI_AUTH')}
                  </Notice>
                ) : null}
              </Row>

              {s.key.set ? (
                <Row label={t('settings.ai.quota')}>
                  <div className="sai__quota">
                    <QuotaMeter quota={s.quota} data-testid="ai-quota" />
                    <Button size="sm" variant="ghost" icon={RefreshCw} busy={busy === 'quota'} onClick={() => void run('quota', () => services.ai.refreshQuota())} data-testid="ai-quota-refresh">{t('ai.quota.refresh')}</Button>
                  </div>
                  {s.quota?.isFreeTier ? <p className="sai__hint">{t('ai.quota.freeTier')}</p> : null}
                </Row>
              ) : null}

              <Row label={t('ai.privacy.title')} wide>
                <RadioGroup
                  label={t('ai.privacy.title')}
                  hideLabel
                  value={s.privacy}
                  onChange={(v) => void setPrivacy(v)}
                  options={[
                    { value: 'zdr', label: t('ai.privacy.zdr'), description: t('ai.privacy.zdrHint') },
                    { value: 'no-training', label: t('ai.privacy.noTraining'), description: t('ai.privacy.noTrainingHint') },
                    { value: 'standard', label: t('ai.privacy.standard'), description: t('ai.privacy.standardHint') },
                  ]}
                  data-testid="ai-privacy"
                />
                {s.privacy === 'zdr' && modelFree ? <Notice tone="warning" data-testid="ai-privacy-zdr-free">{t('ai.privacy.zdrFree')}</Notice> : null}
                {s.privacy === 'standard' ? <p className="sai__hint" data-testid="ai-privacy-standard-note"><ShieldCheck size={13} aria-hidden /> {t('ai.privacy.standardOn')}</p> : null}
              </Row>

              <Row label={t('settings.ai.model')}>
                <Select aria-label={t('settings.ai.model')} value={s.model} onChange={(v) => void run('model', () => services.ai.setModel(v))} options={modelOptions.map((o) => ({ value: o.value, label: o.label }))} fieldClassName="sai__select" data-testid="ai-model" />
                {s.replaced ? <Notice tone="warning" data-testid="ai-model-gone">{t('ai.models.gone', { model: services.ai.label(s.replaced.model).label, replacement: services.ai.label(s.replaced.replacement).label })}</Notice> : null}
              </Row>
              <Row label={t('settings.ai.fallback')}>
                <div className="sai__fallbacks">
                  <Select aria-label={t('settings.ai.fallback')} value={fb[0]!} onChange={(v) => void run('fb', () => services.ai.setFallbacks([v, fb[1]!].filter(Boolean)))} options={fallbackOptions} fieldClassName="sai__select" data-testid="ai-fallback-1" />
                  <span className="sai__then">{t('settings.ai.then')}</span>
                  <Select aria-label={t('settings.ai.then')} value={fb[1]!} onChange={(v) => void run('fb', () => services.ai.setFallbacks([fb[0]!, v].filter(Boolean)))} options={fallbackOptions} fieldClassName="sai__select" data-testid="ai-fallback-2" />
                </div>
                <div className="sai__reset">
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void run('reset', async () => { await services.ai.setModel(recommended); await services.ai.setFallbacks([]); })} data-testid="ai-reset-models">{t('settings.ai.reset')}</Button>
                  {s.freeAtLevel !== null || catalog ? (
                    <span className="sai__hint">
                      {tp('ai.models.available', s.freeAtLevel ?? freeAtLevel.filter((m) => m.free).length, { n: s.freeAtLevel ?? freeAtLevel.filter((m) => m.free).length })}
                      {updated ? ` · ${t('ai.models.updated', { when: updated })}` : ''}
                    </span>
                  ) : null}
                </div>
              </Row>

              <Row label={t('settings.ai.busyPolicy')} wide>
                <RadioGroup
                  label={t('settings.ai.busyPolicy')}
                  hideLabel
                  value={s.busyRelax ? 'nvidia' : 'ask'}
                  onChange={(v) => void setBusyPolicy(v === 'nvidia')}
                  options={[{ value: 'ask', label: t('settings.ai.busyAsk') }, { value: 'nvidia', label: t('settings.ai.busyNvidia') }]}
                  data-testid="ai-busy-policy"
                />
              </Row>
            </>
          ) : (
            <Row label={t('settings.ai.customTitle')} wide>
              <form
                className="sai__custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('custom', async () => {
                    setCustomResult(null);
                    await services.ai.setCustomHost(custom.address);
                    const host = services.ai.settings.get().customHost;
                    if (!host) return;
                    if (custom.key.trim()) await services.ctx.platform.secrets.set(`host:${host.id}`, custom.key.trim());
                    if (custom.model.trim()) await services.ai.setModel(custom.model.trim());
                    const list = await services.ai.catalog().catch(() => []);
                    setCustomResult({ ok: true, text: tp('settings.ai.customOk', list.length, { n: list.length }) });
                  });
                }}
              >
                <TextField label={t('settings.ai.customAddress')} value={custom.address} onChange={(v) => setCustom((c) => ({ ...c, address: v }))} placeholder="http://localhost:11434/v1" spellCheck={false} data-testid="ai-custom-address" />
                <TextField label={t('settings.ai.customKey')} optional={t('common.optional')} type="password" value={custom.key} onChange={(v) => setCustom((c) => ({ ...c, key: v }))} autoComplete="off" data-testid="ai-custom-key" />
                <TextField label={t('settings.ai.customModel')} value={custom.model} onChange={(v) => setCustom((c) => ({ ...c, model: v }))} placeholder="qwen3:8b" spellCheck={false} data-testid="ai-custom-model" />
                <Button type="submit" variant="primary" busy={busy === 'custom'} disabled={!custom.address.trim()} data-testid="ai-custom-test">{t('settings.ai.customTest')}</Button>
              </form>
              <p className="sai__hint">{t('settings.ai.customHint')}</p>
              {s.customHost ? <p className="sai__hint" data-testid="ai-custom-privacy">{t('ai.privacy.custom', { host: s.customHost.label })}</p> : null}
              {customResult ? <Notice tone={customResult.ok ? 'success' : 'danger'} data-testid="ai-custom-result">{customResult.text}</Notice> : null}
            </Row>
          )}

          <Row label={t('settings.ai.answers')} wide>
            <RadioGroup
              label={t('settings.ai.answerLanguage')}
              variant="segmented"
              value={s.answerLanguage}
              onChange={(v) => void run('lang', () => services.ctx.prefs.set('ai.answerLanguage', v))}
              options={[{ value: 'question', label: t('settings.ai.answerSame') }, { value: 'ui', label: t('settings.ai.answerMine', { language: uiLanguage }) }]}
              data-testid="ai-answer-language"
            />
            <Checkbox checked={s.generalDefault} onChange={(on) => void run('general', () => services.ai.setGeneralDefault(on))} label={t('settings.ai.generalDefault')} data-testid="ai-general-default" />
          </Row>
        </div>
        {error ? <Notice tone="danger" data-testid="ai-settings-error">{error}</Notice> : null}
        <div className="sai__foot">
          {s.enabled ? (
            <Button
              variant="danger"
              icon={Power}
              onClick={() => void run('off', () => services.ai.setEnabled(false))}
              data-testid="ai-off"
            >
              {t('settings.ai.off')}
            </Button>
          ) : null}
          <button type="button" className="sai__link" onClick={() => go({ name: 'settings', section: 'privacy' })} data-testid="ai-activity-link">{t('settings.ai.activity')} →</button>
        </div>
      </Section>
    </div>
  );
}

function Row({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sai__row sai__row--wide' : 'sai__row'}>
      <div className="sai__label">{label}</div>
      <div className="sai__control">{children}</div>
    </div>
  );
}
