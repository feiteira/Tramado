// The New class / Class settings dialog (UX §3.3.1): name, short name (suggested until edited), the 12 colours, the
// icon grid (suggested from the name until picked), lecturer and term, the lecture language, sharing; Class settings
// adds the vocabulary, "Ask before letting people in" (organisers of shared classes), "Skip audio files", the
// class's notification level and the danger zone (Leave → UI-GROUP's `leave` dialog; Delete for a local class).
import React, { useEffect, useMemo, useState } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import type { AppServices } from '../../services/types/common';
import type { ClassDetail } from '../../services/types/class';
import { useAppState } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { RadioGroup, Switch } from '../../ui/components/Choice';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { IconPicker } from '../../ui/tramado/IconPicker';
import { suggestColour } from '../../ui/classColor';
import { suggestIcon, type ClassIconName } from '../../ui/classIcons';
import { problemKey } from '../../ui/problems';
import { useI18n } from '../../ui/i18n';
import { LANGUAGES, languageForUi, metaPatch, nameTaken, type ClassForm } from './actions';
import './class.css';

type Notify = 'important' | 'all' | 'none';

export function ClassDialog({ services, classId, close }: { services: AppServices; classId: string | null; close(): void }) {
  const { t } = useI18n();
  const app = useAppState();
  const { go } = useRouter();
  const dialogs = useDialogs();
  const classes = useStore(services.library.classes);
  const cls = classId ? classes.find((c) => c.id === classId) ?? null : null;
  const editing = !!classId;
  const detail = useDetail(services, classId);
  const initial: ClassForm = useMemo(
    () =>
      cls
        ? {
            name: cls.name, shortName: cls.shortName, colour: cls.color, icon: cls.icon, lecturer: cls.lecturer ?? '', term: cls.term ?? '',
            language: cls.language, vocabulary: cls.vocabulary, askBeforeJoin: cls.askBeforeJoin,
          }
        : {
            name: '', shortName: '', colour: suggestColour(classes.filter((c) => !c.archived).map((c) => c.color)), icon: 'book-open',
            lecturer: '', term: '', language: languageForUi(app.locale), vocabulary: '', askBeforeJoin: false,
          },
    // The form starts from the class as it was when the dialog opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classId],
  );
  const [form, setForm] = useState<ClassForm>(initial);
  const [shortEdited, setShortEdited] = useState(editing);
  const [iconPicked, setIconPicked] = useState(editing);
  const [share, setShare] = useState(editing ? !!cls?.shared : true);
  const [skipAudio, setSkipAudio] = useState(!!cls?.skipAudio);
  const [notify, setNotify] = useState<Notify>(cls?.notify ?? ((services.ctx.prefs.get('notify.default') as Notify) || 'important'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const set = <K extends keyof ClassForm>(k: K, v: ClassForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onName = (name: string) => {
    setForm((f) => {
      const s = services.library.suggest(name);
      return { ...f, name, ...(shortEdited ? {} : { shortName: name.trim() ? s.shortName : '' }), ...(iconPicked ? {} : { icon: s.icon as ClassIconName }) };
    });
  };
  const suggested = suggestIcon(form.name || cls?.name || '') as ClassIconName;
  const taken = nameTaken(form.name, classes, classId ?? undefined);
  const nameError = showErrors && !form.name.trim() ? t('classes.dialog.nameRequired') : taken ? t('classes.dialog.nameTaken', { name: form.name.trim() }) : undefined;
  const isOrganiser = !!detail?.me.isOrganiser;
  const wasShared = !!cls?.shared;

  const afterShare = async (id: string) => {
    if (services.ctx.prefs.get('app.trayAsked') !== '1') {
      await app.setPref('app.trayAsked', '1');
      dialogs.open('first-share', { classId: id });
    }
  };

  const submit = async () => {
    setShowErrors(true);
    if (!form.name.trim() || taken) return;
    setBusy(true);
    setError(null);
    try {
      if (!editing) {
        const id = await services.library.create({
          name: form.name, shortName: form.shortName.trim() || undefined, colour: form.colour, icon: form.icon,
          lecturer: form.lecturer.trim() || undefined, term: form.term.trim() || undefined, language: form.language as never, share,
        });
        close();
        go({ name: 'class', classId: id });
        if (share) await afterShare(id);
        return;
      }
      const patch = metaPatch(initial, form);
      if (!isOrganiser || !wasShared) delete patch.askBeforeAdmit;
      const svc = services.forClass(classId!);
      if (Object.keys(patch).length) await svc.info.setMeta(patch as never);
      const id = classId!;
      if (notify !== cls?.notify) await app.setPref(`notify.class.${id}`, notify);
      if (skipAudio !== !!cls?.skipAudio) {
        await services.ctx.platform.classes.update(id, { skipAudio });
        await services.library.load();
      }
      if (share && !wasShared) {
        await services.sync.share(id);
        await services.library.load();
        close();
        await afterShare(id);
        return;
      }
      close();
    } catch (e) {
      const pe = toPlatformError(e);
      setError(t(problemKey(pe) ?? 'common.unknownError', { message: pe.message }));
      setBusy(false);
    }
  };

  const removeClass = useDeleteClass(services);
  const deleteClass = async () => {
    if (cls && (await removeClass(cls))) close();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={editing ? t('classes.dialog.settingsTitle') : t('classes.dialog.newTitle')}
      size="md"
      dismissible={!busy}
      onSubmit={() => void submit()}
      className="class-dialog"
      data-testid={editing ? 'class-settings' : 'class-dialog'}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy} data-testid="class-dialog-cancel">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="class-dialog-save">
            {editing ? t('common.save') : t('classes.dialog.create')}
          </Button>
        </>
      }
    >
      <div className="class-form">
        <TextField
          label={t('classes.dialog.name')}
          placeholder={t('classes.dialog.namePlaceholder')}
          value={form.name}
          onChange={(v) => onName(v.slice(0, 120))}
          error={nameError}
          maxLength={120}
          required
          data-autofocus
          data-testid="class-name"
        />
        <TextField
          label={t('classes.dialog.short')}
          hint={t('classes.dialog.shortHint')}
          value={form.shortName}
          onChange={(v) => {
            setShortEdited(true);
            set('shortName', v.slice(0, 12));
          }}
          maxLength={12}
          fieldClassName="class-form__short"
          data-testid="class-short"
        />
        <ColorPicker label={t('classes.dialog.colour')} value={form.colour} onChange={(hex) => set('colour', hex)} data-testid="class-colour" />
        <div className="class-form__icons">
          <span className="field__label" id="class-icon-label">{t('classes.dialog.icon')}</span>
          <IconPicker
            label={t('classes.dialog.icon')}
            value={form.icon}
            suggested={suggested}
            color={form.colour}
            onChange={(icon) => {
              setIconPicked(true);
              set('icon', icon);
            }}
            data-testid="class-icon"
          />
        </div>
        <div className="class-form__pair">
          <TextField label={t('classes.dialog.lecturer')} optional={t('common.optional')} value={form.lecturer} onChange={(v) => set('lecturer', v.slice(0, 80))} maxLength={80} data-testid="class-lecturer" />
          <TextField label={t('classes.dialog.term')} optional={t('common.optional')} placeholder={t('classes.dialog.termPlaceholder')} value={form.term} onChange={(v) => set('term', v.slice(0, 40))} maxLength={40} data-testid="class-term" />
        </div>
        <Select
          label={t('classes.dialog.language')}
          hint={t('classes.dialog.languageHint')}
          value={form.language}
          onChange={(v) => set('language', v)}
          options={[...LANGUAGES, { value: 'auto', label: t('classes.dialog.languageAuto') }]}
          data-testid="class-language"
        />
        {editing ? (
          <TextArea
            label={t('classes.dialog.vocabulary')}
            hint={t('classes.dialog.vocabularyHint')}
            value={form.vocabulary}
            onChange={(v) => set('vocabulary', v.slice(0, 500))}
            maxLength={500}
            autoGrow
            minHeight={64}
            maxHeight={160}
            readOnly={!!cls?.newerFormat}
            data-testid="class-vocabulary"
          />
        ) : null}
        {!wasShared ? (
          <Switch label={t('classes.dialog.share')} description={share ? t('classes.dialog.shareOn') : t('classes.dialog.shareOff')} checked={share} onChange={setShare} data-testid="class-share" />
        ) : null}
        {editing && wasShared && isOrganiser ? (
          <Switch
            label={t('classes.dialog.askBeforeJoin')}
            description={t('classes.dialog.askBeforeJoinHint')}
            checked={form.askBeforeJoin}
            onChange={(v) => set('askBeforeJoin', v)}
            data-testid="class-ask-before-join"
          />
        ) : null}
        {editing ? (
          <Switch label={t('classes.dialog.skipAudio')} description={t('classes.dialog.skipAudioHint')} checked={skipAudio} onChange={setSkipAudio} data-testid="class-skip-audio" />
        ) : null}
        {editing ? (
          <RadioGroup
            label={t('classes.dialog.notify')}
            value={notify}
            onChange={(v: Notify) => setNotify(v)}
            options={(['important', 'all', 'none'] as const).map((v) => ({ value: v, label: t(`classes.header.notify.${v}`) }))}
            data-testid="class-notify"
          />
        ) : null}
        {error ? <Notice tone="danger" data-testid="class-dialog-error">{error}</Notice> : null}
        {editing && cls ? (
          <section className="class-form__danger" aria-labelledby="class-danger-title">
            <h3 id="class-danger-title" className="class-form__danger-title">{t('classes.dialog.danger')}</h3>
            {cls.shared ? (
              <Button variant="danger" icon={LogOut} onClick={() => dialogs.open('leave', { classId: cls.id })} data-testid="class-leave">
                {t('classes.header.more.leave')}
              </Button>
            ) : (
              <Button variant="danger" icon={Trash2} onClick={() => void deleteClass()} data-testid="class-delete">
                {t('classes.header.more.delete')}
              </Button>
            )}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Delete a local class (UX §3.3.4): type the class name to confirm, then the folder goes to the OS trash and the app
 * returns to Today. Resolves true when the class was deleted. Used by Class settings and the header's ⋯ menu.
 */
export function useDeleteClass(services: AppServices): (cls: { id: string; name: string }) => Promise<boolean> {
  const { t } = useI18n();
  const { go } = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  return async (cls) => {
    const ok = await confirm({
      title: t('classes.delete.title', { class: cls.name }),
      body: t('classes.delete.body'),
      confirmLabel: t('classes.delete.confirm'),
      danger: true,
      typeToConfirm: cls.name,
      typePrompt: t('classes.delete.typePrompt'),
    });
    if (!ok) return false;
    try {
      await services.library.forget(cls.id, { trash: true });
      go({ name: 'today' });
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };
}

/** The class detail (organisers, me), or null for a new class. */
function useDetail(services: AppServices, classId: string | null): ClassDetail | null {
  const [d, setD] = useState<ClassDetail | null>(null);
  useEffect(() => {
    if (!classId) return undefined;
    try {
      const store = services.forClass(classId).info.detail;
      setD(store.get());
      return store.subscribe(() => setD(store.get()));
    } catch {
      return undefined;
    }
  }, [services, classId]);
  return d;
}
