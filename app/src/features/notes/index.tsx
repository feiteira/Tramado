// The note editor (route `note`, UX §3.8, `screen-note`): the title from the first heading, "Only you" or "Shared
// with the class · {n} members" with the save status; a roving toolbar (bold, italic, heading, bullets, checklist,
// link, timestamp link, document link, preview); a Markdown text area in the reading font, saved 2 s after the last
// change (Ctrl/⌘+S now); the preview through MarkdownView with in-app tramado: links; who else is editing; the
// conflict notice with the compare dialog; moving between My notes and Class notes (never silent); delete.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Clock3, Ellipsis, Eye, FileText, FolderOpen, GitCompareArrows, Heading, Italic, Link2, List, ListChecks, Lock, PencilLine, Trash2, Users, UsersRound,
} from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import { noteTitle } from '../../core/notes/conflicts';
import type { AppServices } from '../../services/types/common';
import { Missing } from '../../shell/Placeholder';
import { useRouter } from '../../shell/router';
import type { Route } from '../../shell/routes';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useKeyLabel } from '../../shell/keys';
import { useSaver } from '../../shell/AppState';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, Spinner, Toolbar, ToolbarDivider, ToolbarSpacer } from '../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { MarkdownView } from '../../ui/tramado/MarkdownView';
import { findQuote } from '../document/locate';
import { useNavigatorRegistration } from '../search/navigate';
import { ConflictDialog } from './ConflictDialog';
import { clock, docLink, insert, link, parseClock, parseTramadoLink, timeLink, toggleLines, wrap, type Edit } from './format';
import './notes.css';

type NoteRoute = Extract<Route, { name: 'note' }>;
const SAVE_DEBOUNCE_MS = 2000;
type Status = { kind: 'saved' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'failed'; reason: string };

export default function NoteScreen({ route, services }: { route: NoteRoute; services: AppServices }) {
  useNavigatorRegistration();
  const { t } = useI18n();
  const scope = route.private ? 'private' : 'class';
  const cls = services.forClass(route.classId);
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    setMissing(false);
    void cls.notes.read(scope, route.relPath).then((t) => live && setText(t), (e: unknown) => {
      if (!live) return;
      if (toPlatformError(e).code === 'NOT_FOUND' || toPlatformError(e).code === 'INVALID') setMissing(true);
      else setText('');
    });
    return () => {
      live = false;
    };
  }, [cls, scope, route.relPath]);

  if (missing) return <Missing what="note" />;
  if (text === null) {
    return (
      <>
        <ScreenHeader title={route.relPath.slice(route.relPath.lastIndexOf('/') + 1).replace(/\.md$/i, '')} />
        <div className="note-screen" data-testid="screen-note" aria-busy><Spinner label={t('common.loading')} /></div>
      </>
    );
  }
  return <NoteEditor key={`${scope}:${route.relPath}`} route={route} services={services} initial={text} />;
}

function NoteEditor({ route, services, initial }: { route: NoteRoute; services: AppServices; initial: string }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const key = useKeyLabel();
  const toast = useToast();
  const confirm = useConfirm();
  const { go, replace, back, canGoBack } = useRouter();
  const scope: 'class' | 'private' = route.private ? 'private' : 'class';
  const cls = services.forClass(route.classId);
  const notes = useStore(cls.notes.list);
  const detail = useStore(cls.info.detail);
  const classes = useStore(services.library.classes);
  const view = classes.find((c) => c.id === route.classId);
  const summary = notes.find((n) => n.path === route.relPath && n.scope === scope);
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: 'saved' });
  const [preview, setPreview] = useState(false);
  const [compare, setCompare] = useState(false);
  const [pop, setPop] = useState<'time' | 'doc' | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ url: string; error: string | null } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const timeBtn = useRef<HTMLButtonElement>(null);
  const docBtn = useRef<HTMLButtonElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const title = noteTitle(route.relPath, text);
  const members = detail.people.filter((p) => !p.banned).length;

  // ── Saving: 2 s after the last change, Ctrl/⌘+S now, and before the window closes ──
  const save = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    const body = textRef.current;
    if (body === saved.current) {
      setStatus({ kind: 'saved' });
      return;
    }
    setStatus({ kind: 'saving' });
    const run = cls.notes.save(scope, route.relPath, body).then(() => {
      saved.current = body;
      setStatus(textRef.current === body ? { kind: 'saved' } : { kind: 'dirty' });
    }, (e: unknown) => {
      setStatus({ kind: 'failed', reason: t(`errors.${toPlatformError(e).code}` as 'errors.INVALID') });
    });
    saving.current = run.finally(() => {
      saving.current = null;
    });
    await saving.current;
  }, [cls, scope, route.relPath, t]);
  useSaver(save);
  useEffect(() => () => {
    if (textRef.current !== saved.current) void save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (next: string) => {
    setText(next);
    setStatus({ kind: 'dirty' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };

  // Presence: others see "Ana is editing this note" while this class note is open.
  useEffect(() => {
    if (scope !== 'class') return;
    cls.notes.editing(route.relPath);
    return () => cls.notes.editing(null);
  }, [cls, scope, route.relPath]);

  // The note changed on disk (a classmate, a conflict resolved) while nothing here is unsaved: show it.
  useEffect(() => {
    if (!summary || status.kind !== 'saved') return;
    let live = true;
    void cls.notes.read(scope, route.relPath).then((disk) => {
      if (!live || textRef.current !== saved.current || disk === saved.current) return;
      saved.current = disk;
      setText(disk);
    }, () => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.mtimeMs]);

  // A quote (a search hit, a citation): select it in the text.
  useEffect(() => {
    if (!route.quote) return;
    const hit = findQuote(initial, route.quote);
    const el = editor.current;
    if (!hit || !el) return;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(hit.start, hit.end);
      const line = initial.slice(0, hit.start).split('\n').length;
      el.scrollTop = Math.max(0, (line - 4) * 28);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Editing commands (through insertText, so the text area's own undo keeps working) ──
  const apply = (f: (text: string, start: number, end: number) => Edit) => {
    const el = editor.current;
    if (!el) return;
    const before = el.value;
    const r = f(before, el.selectionStart, el.selectionEnd);
    let a = 0;
    while (a < before.length && a < r.text.length && before[a] === r.text[a]) a++;
    let b = 0;
    while (b < before.length - a && b < r.text.length - a && before[before.length - 1 - b] === r.text[r.text.length - 1 - b]) b++;
    el.focus();
    el.setSelectionRange(a, before.length - b);
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, r.text.slice(a, r.text.length - b));
    if (!ok || el.value !== r.text) change(r.text);
    requestAnimationFrame(() => el.setSelectionRange(r.start, r.end));
  };
  const bold = () => apply((x, s, e) => wrap(x, s, e, '**', t('notes.toolbar.bold')));
  const italic = () => apply((x, s, e) => wrap(x, s, e, '_', t('notes.toolbar.italic')));
  const heading = () => apply((x, s, e) => toggleLines(x, s, e, '## '));
  const bullets = () => apply((x, s, e) => toggleLines(x, s, e, '- '));
  const checklist = () => apply((x, s, e) => toggleLines(x, s, e, '- [ ] '));
  const openLink = () => setLinkDialog({ url: 'https://', error: null });
  const togglePreview = () => setPreview((p) => !p);

  const onEditorKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'b' && !e.shiftKey) {
      e.preventDefault();
      bold();
    } else if (k === 'i' && !e.shiftKey) {
      e.preventDefault();
      italic();
    } else if (k === 'k' && !e.shiftKey) {
      // Inside the editor Ctrl/⌘+K is Link (UX §3.8); the palette stays on the rail button.
      e.preventDefault();
      e.stopPropagation();
      openLink();
    } else if (k === 's') {
      e.preventDefault();
      void save();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        togglePreview();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const onLink = (href: string) => {
    const l = parseTramadoLink(href);
    if (l?.kind === 'lecture') go({ name: 'lecture', classId: route.classId, lectureId: l.id, ...(l.ms !== null ? { at: l.ms } : {}) });
    else if (l?.kind === 'doc') go({ name: 'document', classId: route.classId, relPath: l.path, ...(l.page ? { page: l.page } : {}) });
    else void services.ctx.platform.system.openExternal(href, { title: t('notes.toolbar.link'), message: href, confirm: t('common.open'), cancel: t('common.cancel') }).catch(() => undefined);
  };

  // ── Moving, deleting ──
  const move = async (to: 'class' | 'private') => {
    const ok = await confirm(to === 'class'
      ? { title: t('notes.toClass.title', { class: view?.name ?? '' }), body: t('notes.toClass.body'), confirmLabel: t('notes.toClass.confirm') }
      : { title: t('notes.toMine.title'), body: t('notes.toMine.body', { class: view?.name ?? '' }), confirmLabel: t('notes.toMine.confirm') });
    if (!ok) return;
    try {
      await save();
      const next = await cls.notes.moveTo(scope, route.relPath, to);
      saved.current = textRef.current;
      replace({ name: 'note', classId: route.classId, relPath: next, private: to === 'private' });
      toast.show({ tone: 'success', message: to === 'class' ? t('notes.movedToClass') : t('notes.movedToMine') });
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    const ok = await confirm({
      title: t('notes.deleteConfirm.title', { title }),
      body: scope === 'private' ? t('notes.deleteConfirm.bodyMine') : t('notes.deleteConfirm.bodyClass', { class: view?.name ?? '' }),
      confirmLabel: t('common.delete'), danger: true,
    });
    if (!ok) return;
    try {
      if (timer.current) clearTimeout(timer.current);
      saved.current = textRef.current;
      await cls.notes.remove(scope, route.relPath);
      toast.show(t('notes.deleted', { title }));
      if (canGoBack) back();
      else go({ name: 'class', classId: route.classId, tab: 'notes' });
    } catch (e) {
      toast.error(e);
    }
  };
  const moreItems: MenuEntry[] = [
    ...(scope === 'private' && view?.shared ? [{ id: 'toClass', label: t('notes.more.toClass'), icon: UsersRound, onSelect: () => void move('class'), testId: 'note-more-class' }] : []),
    ...(scope === 'class' ? [{ id: 'toMine', label: t('notes.more.toMine'), icon: Lock, onSelect: () => void move('private'), testId: 'note-more-private' }] : []),
    ...(scope === 'class' ? [{ id: 'reveal', label: t('notes.more.showInFolder'), icon: FolderOpen, onSelect: () => void services.ctx.platform.classes.reveal(route.classId, route.relPath).catch((e: unknown) => toast.error(e)), testId: 'note-more-reveal' }] : []),
    { kind: 'separator' },
    { id: 'delete', label: t('notes.more.delete'), icon: Trash2, danger: true, onSelect: () => void remove(), testId: 'note-more-delete' },
  ];

  const statusText = status.kind === 'saving' ? t('notes.status.saving') : status.kind === 'failed' ? t('notes.status.failed', { reason: status.reason })
    : status.kind === 'dirty' ? '' : t('notes.status.saved');
  const subtitle = (
    <span className="note-subtitle">
      {scope === 'private' ? <><Lock size={13} aria-hidden /> {t('notes.subtitleMine')}</> : <><Users size={13} aria-hidden /> {tp('notes.subtitleClass', members)}</>}
      <span className={cx('note-status', status.kind === 'failed' && 'note-status--failed')} role="status" aria-live="polite" data-testid="note-status" data-state={status.kind}>
        {statusText ? ` · ${statusText}` : ''}
      </span>
    </span>
  );
  const others = summary?.editingBy ?? [];

  return (
    <>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        backTo={t('classes.tabs.notes')}
        more={<MenuButton iconOnly icon={Ellipsis} label={t('common.more')} variant="ghost" align="end" items={moreItems} data-testid="note-more" />}
      />
      <div className="note-screen" data-testid="screen-note" data-doc-path={route.relPath} data-private={scope === 'private' ? 'true' : 'false'}>
        {others.length ? <Notice tone="info" icon={Users} data-testid="note-presence">{t('notes.presence', { name: others.join(', ') })}</Notice> : null}
        {summary?.conflict ? (
          <Notice
            tone="warning"
            icon={GitCompareArrows}
            data-testid="note-conflict"
            actions={<Button size="sm" onClick={async () => { await save(); setCompare(true); }} data-testid="note-compare">{t('notes.conflict.compare')}</Button>}
          >
            {t('notes.conflict.notice', { title })}
          </Notice>
        ) : null}
        {status.kind === 'failed' ? <Notice tone="danger" data-testid="note-save-failed" actions={<Button size="sm" onClick={() => void save()}>{t('common.tryAgain')}</Button>}>{t('notes.status.failed', { reason: status.reason })}</Notice> : null}

        <Toolbar label={t('notes.toolbar.label')} roving className="note-toolbar" data-testid="note-toolbar">
          <IconButton icon={Bold} label={t('notes.toolbar.bold')} shortcut={key('B')} onClick={bold} disabled={preview} data-testid="note-bold" />
          <IconButton icon={Italic} label={t('notes.toolbar.italic')} shortcut={key('I')} onClick={italic} disabled={preview} data-testid="note-italic" />
          <IconButton icon={Heading} label={t('notes.toolbar.heading')} onClick={heading} disabled={preview} data-testid="note-heading" />
          <ToolbarDivider />
          <IconButton icon={List} label={t('notes.toolbar.bullets')} onClick={bullets} disabled={preview} data-testid="note-list-bullets" />
          <IconButton icon={ListChecks} label={t('notes.toolbar.checklist')} onClick={checklist} disabled={preview} data-testid="note-checklist" />
          <IconButton icon={Link2} label={t('notes.toolbar.link')} shortcut={key('K')} onClick={openLink} disabled={preview} data-testid="note-link" />
          <ToolbarDivider />
          <IconButton ref={timeBtn} icon={Clock3} label={t('notes.toolbar.insertTime')} onClick={() => setPop('time')} disabled={preview} data-testid="note-insert-time" />
          <IconButton ref={docBtn} icon={FileText} label={t('notes.toolbar.insertDoc')} onClick={() => setPop('doc')} disabled={preview} data-testid="note-insert-doc" />
          <ToolbarSpacer />
          <Button size="sm" variant={preview ? 'primary' : 'ghost'} icon={preview ? PencilLine : Eye} onClick={togglePreview} aria-pressed={preview} title={key('P', { shift: true })} data-testid="note-preview">
            {preview ? t('notes.previewOff') : t('notes.toolbar.preview')}
          </Button>
        </Toolbar>

        <div className="note-body">
          {preview ? (
            <div className="note-preview" data-testid="note-preview-view">
              <MarkdownView source={text} links="all" onLink={onLink} className="markdown reading note-preview__md" />
            </div>
          ) : (
            <TextArea
              ref={editor}
              value={text}
              onChange={change}
              onKeyDown={onEditorKey}
              reading
              aria-label={t('notes.toolbar.label')}
              placeholder={t('notes.placeholder')}
              spellCheck
              fieldClassName="note-editor-field"
              className="note-editor"
              data-testid="note-editor"
            />
          )}
        </div>
      </div>

      {pop === 'time' ? <InsertTime services={services} classId={route.classId} anchor={timeBtn} onClose={() => setPop(null)} onInsert={(s) => apply((x, a, b) => insert(x, a, b, s))} /> : null}
      {pop === 'doc' ? <InsertDoc services={services} classId={route.classId} anchor={docBtn} onClose={() => setPop(null)} onInsert={(s) => apply((x, a, b) => insert(x, a, b, s))} /> : null}
      {linkDialog ? (
        <Dialog
          open
          onClose={() => setLinkDialog(null)}
          title={t('notes.linkDialog.title')}
          size="sm"
          onSubmit={() => {
            const url = linkDialog.url.trim();
            if (!/^https:\/\/\S+$/i.test(url)) {
              setLinkDialog({ ...linkDialog, error: t('notes.linkDialog.invalid') });
              return;
            }
            setLinkDialog(null);
            apply((x, a, b) => link(x, a, b, url, t('notes.untitledLink')));
          }}
          data-testid="note-link-dialog"
          footer={
            <>
              <Button onClick={() => setLinkDialog(null)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" data-testid="note-link-insert">{t('notes.linkDialog.insert')}</Button>
            </>
          }
        >
          <TextField label={t('notes.linkDialog.url')} hint={t('notes.linkDialog.urlHint')} value={linkDialog.url} error={linkDialog.error ?? undefined} onChange={(v) => setLinkDialog({ url: v, error: null })} data-autofocus inputMode="url" data-testid="note-link-url" />
        </Dialog>
      ) : null}
      {compare ? (
        <ConflictDialog
          services={services}
          classId={route.classId}
          path={route.relPath}
          title={title}
          onClose={() => setCompare(false)}
          onResolved={(kept) => {
            if (kept === null) return;
            saved.current = kept;
            setText(kept);
            setStatus({ kind: 'saved' });
          }}
        />
      ) : null}
    </>
  );
}

function InsertTime({ services, classId, anchor, onClose, onInsert }: { services: AppServices; classId: string; anchor: React.RefObject<HTMLButtonElement | null>; onClose(): void; onInsert(s: string): void }) {
  const { t } = useI18n();
  const lectures = useStore(services.forClass(classId).lectures.list);
  const [id, setId] = useState(lectures[0]?.id ?? '');
  const [time, setTime] = useState(clock(0));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id && lectures[0]) setId(lectures[0].id);
  }, [lectures, id]);
  const submit = () => {
    const ms = parseClock(time);
    if (ms === null) {
      setError(t('notes.insertTime.invalid'));
      return;
    }
    onClose();
    onInsert(timeLink(id, ms));
  };
  return (
    <Popover open onClose={onClose} anchor={anchor} padded aria-label={t('notes.insertTime.title')} data-testid="note-insert-time-popover">
      <form className="note-pop" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 className="note-pop__title">{t('notes.insertTime.title')}</h2>
        {lectures.length ? (
          <>
            <Select label={t('notes.insertTime.lecture')} value={id} onChange={setId} options={lectures.map((l) => ({ value: l.id, label: l.title }))} data-testid="note-insert-time-lecture" />
            <TextField label={t('notes.insertTime.time')} value={time} onChange={(v) => { setTime(v); setError(null); }} error={error ?? undefined} inputMode="numeric" data-testid="note-insert-time-at" />
            <Button variant="primary" type="submit" data-testid="note-insert-time-ok">{t('notes.insertTime.insert')}</Button>
          </>
        ) : <p className="t-muted t-small">{t('notes.insertTime.none')}</p>}
      </form>
    </Popover>
  );
}

function InsertDoc({ services, classId, anchor, onClose, onInsert }: { services: AppServices; classId: string; anchor: React.RefObject<HTMLButtonElement | null>; onClose(): void; onInsert(s: string): void }) {
  const { t } = useI18n();
  const cls = services.forClass(classId);
  const all = useStore(cls.documents.list);
  const docsDir = cls.store.dir('documents');
  const docs = useMemo(() => all.filter((d) => d.path.startsWith(`${docsDir}/`) && !d.conflictOf).sort((a, b) => a.name.localeCompare(b.name)), [all, docsDir]);
  const [path, setPath] = useState(docs[0]?.path ?? '');
  const [page, setPage] = useState('');
  useEffect(() => {
    if (!path && docs[0]) setPath(docs[0].path);
  }, [docs, path]);
  const doc = docs.find((d) => d.path === path);
  const paged = doc?.kind === 'pdf';
  const submit = () => {
    if (!doc) return;
    const n = Number(page);
    onClose();
    onInsert(docLink(doc.path, doc.name.replace(/\.[^.]+$/, ''), paged && Number.isInteger(n) && n > 0 ? n : null, (p) => t('documents.view.pageShort', { n: p })));
  };
  return (
    <Popover open onClose={onClose} anchor={anchor} padded aria-label={t('notes.insertDoc.title')} data-testid="note-insert-doc-popover">
      <form className="note-pop" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 className="note-pop__title">{t('notes.insertDoc.title')}</h2>
        {docs.length ? (
          <>
            <Select label={t('notes.insertDoc.document')} value={path} onChange={setPath} options={docs.map((d) => ({ value: d.path, label: d.name }))} data-testid="note-insert-doc-file" />
            {paged ? <TextField label={t('notes.insertDoc.page')} optional={t('common.optional')} value={page} onChange={setPage} inputMode="numeric" data-testid="note-insert-doc-page" /> : null}
            <Button variant="primary" type="submit" data-testid="note-insert-doc-ok">{t('notes.insertDoc.insert')}</Button>
          </>
        ) : <p className="t-muted t-small">{t('notes.insertDoc.none')}</p>}
      </form>
    </Popover>
  );
}
