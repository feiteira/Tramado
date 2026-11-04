// The Documents tab (UX §3.7.1, ready marker `doc-list`): folders with a breadcrumb or Recent, filter and sort, the
// "Text for search & AI" chip of each file, "Only on this computer" files, the suggested folders card, adding by
// the picker or a drop (DropOverlay), and the row menu (open, system app, show in folder, rename, move, keep
// private, read with AI, remove here only, delete for everyone with Undo). Keys: ↑/↓, Enter, Backspace, Delete, F2,
// Ctrl/⌘+F.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  ChevronRight, Ellipsis, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, Files, Folder, FolderInput, FolderOpen, FolderPlus,
  HardDrive, Lock, LockOpen, Paperclip, Pencil, Plus, Presentation, ScanText, Sparkles, Trash2, TriangleAlert, CircleCheck, CircleX, Copy,
  GitCompareArrows, type LucideIcon,
} from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { DocSummary } from '../../services/types/documents';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge, EmptyState, ProgressBar } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { Menu, type MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { Tooltip } from '../../ui/components/Tooltip';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import type { Rect } from '../../ui/position';
import { DropOverlay } from '../../ui/tramado/DropOverlay';
import { useNavigatorRegistration } from '../search/navigate';
import { DeleteDialog, MoveDialog, NameDialog } from './dialogs';
import {
  DEFAULT_SORT, SUGGESTED_FOLDERS, crumbs, fileCounts, folderPath, inDocuments, parentOf, relFolder, rowsFor, textChip, type Sort, type SortKey,
} from './model';
import { onQueuedImport, takeQueuedImport, useDocImport } from './useDocImport';
import './documents.css';

const KIND_ICON: Record<DocSummary['kind'], LucideIcon> = {
  pdf: FileText, docx: FileText, odt: FileText, rtf: FileText, md: FileText, txt: FileText, html: FileText,
  pptx: Presentation, image: FileImage, audio: FileAudio, video: FileVideo, other: File,
};
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

type Modal =
  | { kind: 'newFolder' } | { kind: 'rename'; doc: DocSummary } | { kind: 'move'; doc: DocSummary } | { kind: 'delete'; doc: DocSummary };

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  useNavigatorRegistration();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const confirm = useConfirm();
  const { route, go, replace } = useRouter();
  const cls = services.forClass(classId);
  const all = useStore(cls.documents.list);
  const folderList = useStore(cls.documents.folders);
  const storeState = useStore(cls.store.state);
  const extraction = useStore(services.extraction.status);
  const classes = useStore(services.library.classes);
  const aiSettings = useStore(services.ai.settings);
  const view = classes.find((c) => c.id === classId);
  const docsDir = cls.store.dir('documents');
  const relRoute = route.name === 'class' ? route.folder : undefined;
  const folder = folderPath(docsDir, relRoute);
  const [mode, setMode] = useState<'folders' | 'recent'>('folders');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ doc: DocSummary; at: Rect } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [dragging, setDragging] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState<boolean | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const importer = useDocImport(classId, services);
  const shared = view?.shared ?? false;
  const loading = storeState.status === 'loading';
  const aiOn = aiSettings.enabled && aiSettings.key.set;

  const files = useMemo(() => inDocuments(all, docsDir), [all, docsDir]);
  const docFolders = useMemo(() => folderList.filter((f) => f.startsWith(`${docsDir}/`)), [folderList, docsDir]);
  const who = useCallback((d: DocSummary) => (d.addedBy ? (d.addedBy.self ? t('common.you') : d.addedBy.name) : ''), [t]);
  const rows = useMemo(() => rowsFor({ files, folders: docFolders, folder, view: mode, filter, sort, who }), [files, docFolders, folder, mode, filter, sort, who]);
  const counts = useMemo(() => fileCounts(files), [files]);
  const ordered = useMemo(() => [...rows.folders, ...rows.shared.map((d) => d.path), ...rows.local.map((d) => d.path)], [rows]);
  const byPath = useMemo(() => new Map(files.map((d) => [d.path, d])), [files]);
  const now = DateTime.fromMillis(services.ctx.clock.now());

  // The suggested folders card: once the class has files and no folders, until [No thanks] (class ui-state).
  useEffect(() => {
    let live = true;
    void cls.info.uiState().then((s) => {
      const d = (s.dismissed ?? {}) as Record<string, unknown>;
      if (live) setSuggestDismissed(d.docFolders === true);
    }, () => live && setSuggestDismissed(false));
    return () => {
      live = false;
    };
  }, [cls]);
  const showSuggest = suggestDismissed === false && !loading && files.length > 0 && docFolders.length === 0 && mode === 'folders' && folder === docsDir;

  // Picks queued by the palette/Today "Add documents…" action, and files dropped on the window (app:drop tokens).
  useEffect(() => {
    const take = () => {
      const queued = takeQueuedImport(classId);
      if (queued) void importer.add(queued, mode === 'folders' ? folder : docsDir);
    };
    take();
    const offQueue = onQueuedImport(take);
    const offDrop = services.ctx.platform.events.onDrop((e) => {
      setDragging(false);
      void importer.add(e.picked, mode === 'folders' ? folder : docsDir);
    });
    return () => {
      offQueue();
      offDrop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, folder, mode]);

  const goFolder = (path: string) => {
    if (route.name !== 'class') return;
    setFilter('');
    replace({ ...route, tab: 'documents', folder: relFolder(docsDir, path) || undefined });
  };
  const open = (d: DocSummary) => go({ name: 'document', classId, relPath: d.path, ...(d.sha256 ? { sha256: d.sha256 } : {}) });

  const focusRow = (path: string | null) => {
    setFocused(path);
    if (!path) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-doc-path="${CSS.escape(path)}"]`);
    if (el) el.focus();
    else requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-doc-path="${CSS.escape(path)}"]`)?.focus());
  };

  // ── Actions ──
  const del = async (d: DocSummary) => {
    try {
      const removed = await cls.documents.removeForUndo(d.path);
      toast.show({
        message: t('documents.deleteConfirm.done', { file: d.name }),
        action: { label: t('common.undo'), testId: 'toast-undo', run: () => cls.documents.restore(removed).catch((e: unknown) => toast.error(e)) },
      });
    } catch (e) {
      toast.error(e);
    }
  };
  const removeLocal = async (d: DocSummary) => {
    const ok = await confirm({ title: t('documents.removeLocal.title', { file: d.name }), body: t('documents.removeLocal.body'), confirmLabel: t('documents.removeLocal.confirm'), 'data-testid': 'confirm-dialog' });
    if (!ok) return;
    try {
      await cls.documents.remove(d.path, 'thisComputer');
      toast.show(t('documents.removeLocal.done', { file: d.name }));
    } catch (e) {
      toast.error(e);
    }
  };
  const makePrivate = async (d: DocSummary) => {
    const ok = await confirm({ title: t('documents.makePrivate.title', { file: d.name }), body: t('documents.makePrivate.body', { class: view?.name ?? '' }), confirmLabel: t('documents.makePrivate.confirm') });
    if (!ok) return;
    try {
      await cls.documents.keepPrivate(d.path);
      toast.show({ tone: 'success', message: t('documents.makePrivate.done', { file: d.name }) });
    } catch (e) {
      toast.error(e);
    }
  };
  const sharePrivate = async (d: DocSummary) => {
    const ok = await confirm({ title: t('documents.sharePrivate.title', { file: d.name }), body: t('documents.sharePrivate.body', { class: view?.name ?? '' }), confirmLabel: t('documents.sharePrivate.confirm') });
    if (!ok) return;
    await cls.documents.share(d.path).catch((e: unknown) => toast.error(e));
  };

  const menuItems = (d: DocSummary): MenuEntry[] => {
    const scanOk = d.extraction === 'scan' && (d.pages ?? 0) <= 20 && aiOn;
    return [
      { id: 'open', label: t('documents.menu.open'), icon: FolderOpen, onSelect: () => open(d), testId: 'doc-menu-open' },
      { id: 'system', label: t('documents.menu.openSystem'), icon: ExternalLink, onSelect: () => void cls.documents.open(d.path).catch((e: unknown) => toast.error(e)), testId: 'doc-menu-system' },
      { id: 'reveal', label: t('documents.menu.showInFolder'), icon: Folder, onSelect: () => void cls.documents.reveal(d.path).catch((e: unknown) => toast.error(e)), testId: 'doc-menu-reveal' },
      { kind: 'separator' },
      { id: 'rename', label: t('documents.menu.rename'), icon: Pencil, hint: 'F2', onSelect: () => setModal({ kind: 'rename', doc: d }), testId: 'doc-menu-rename' },
      { id: 'move', label: `${t('documents.menu.moveTo')}…`, icon: FolderInput, onSelect: () => setModal({ kind: 'move', doc: d }), testId: 'doc-menu-move' },
      ...(shared && !d.localOnly ? [{ id: 'private', label: t('documents.menu.makePrivate'), icon: Lock, onSelect: () => void makePrivate(d), testId: 'doc-menu-private' }] : []),
      ...(shared && d.localOnly ? [{ id: 'share', label: t('documents.menu.sharePrivate'), icon: LockOpen, onSelect: () => void sharePrivate(d), testId: 'doc-menu-share' }] : []),
      ...(scanOk ? [{ id: 'ocr', label: t('documents.menu.ocr'), icon: Sparkles, onSelect: () => go({ name: 'document', classId, relPath: d.path }), testId: 'doc-menu-ocr' }] : []),
      { kind: 'separator' },
      ...(shared && !d.localOnly ? [{ id: 'local', label: t('documents.menu.removeLocal'), icon: HardDrive, onSelect: () => void removeLocal(d), testId: 'doc-menu-local' }] : []),
      { id: 'delete', label: shared && !d.localOnly ? t('documents.menu.delete') : t('documents.menu.deleteLocal'), icon: Trash2, danger: true, hint: 'Del', onSelect: () => setModal({ kind: 'delete', doc: d }), testId: 'doc-menu-delete' },
    ];
  };

  const onRowKey = (e: React.KeyboardEvent, path: string) => {
    const i = ordered.indexOf(path);
    const d = byPath.get(path);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) focusRow(next);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusRow(e.key === 'Home' ? ordered[0] ?? null : ordered.at(-1) ?? null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (d) open(d);
      else goFolder(path);
    } else if (e.key === 'Delete' && d) {
      e.preventDefault();
      setModal({ kind: 'delete', doc: d });
    } else if (e.key === 'F2' && d) {
      e.preventDefault();
      setModal({ kind: 'rename', doc: d });
    } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && d) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ doc: d, at: { top: r.top, left: r.left + 24, width: 0, height: r.height } });
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement) && mode === 'folders' && folder !== docsDir) {
      e.preventDefault();
      const from = folder;
      goFolder(parentOf(folder));
      setTimeout(() => focusRow(from), 50);
    }
  };

  // Ctrl/⌘+F filters (UX §3.7.1 keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sortBy = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'date' ? 'desc' : 'asc' }));
  const sortOf = (k: SortKey) => (mode === 'folders' && sort.key === k ? sort.dir : null);

  const dateOf = (ms: number) => {
    if (!ms) return '—';
    const dt = DateTime.fromMillis(ms).setLocale(i18n.meta.bcp47);
    return dt.year === now.year ? dt.toLocaleString({ day: 'numeric', month: 'short' }) : dt.toLocaleString(DateTime.DATE_MED);
  };
  const pagesOf = (d: DocSummary) => {
    if (d.pages === null) return '—';
    return d.kind === 'pptx' ? tp('documents.tab.slides', d.pages) : String(d.pages);
  };

  const chip = (d: DocSummary) => {
    const c = textChip(d, d.sha256 ? extraction.progress?.[d.sha256] : undefined);
    switch (c.kind) {
      case 'searchable': return <span className="doc-chip doc-chip--ok" data-testid="doc-text-state" data-state="ready"><CircleCheck size={14} aria-hidden />{t('documents.text.searchable')}</span>;
      case 'reading': return (
        <span className="doc-chip doc-chip--reading" data-testid="doc-text-state" data-state="reading">
          <span>{t('documents.text.reading', { percent: c.percent })}</span>
          <ProgressBar value={c.percent / 100} label={t('documents.text.reading', { percent: c.percent })} className="doc-chip__bar" />
        </span>
      );
      case 'scan': return <span className="doc-chip doc-chip--warn" data-testid="doc-text-state" data-state="scan"><ScanText size={14} aria-hidden />{t('documents.text.scan')}</span>;
      case 'somePages': return <span className="doc-chip doc-chip--warn" data-testid="doc-text-state" data-state="some"><TriangleAlert size={14} aria-hidden />{tp('documents.text.somePages', c.n)}</span>;
      case 'failed': return (
        <Tooltip label={t('errors.INVALID')}>
          <span className="doc-chip doc-chip--bad" data-testid="doc-text-state" data-state="failed" tabIndex={0}><CircleX size={14} aria-hidden />{t('documents.text.failed')}</span>
        </Tooltip>
      );
      case 'arriving': return <span className="doc-chip doc-chip--muted" data-testid="doc-text-state" data-state="arriving">{t('common.arriving')}</span>;
      case 'none': return <span className="doc-chip doc-chip--muted" data-testid="doc-text-state" data-state="none">—</span>;
    }
  };

  const flags = (d: DocSummary) => (
    <>
      {d.conflictOf ? <Badge tone="warning" title={t('documents.chips.conflictOf', { file: nameOf(d.conflictOf) })}><GitCompareArrows size={12} aria-hidden /> {t('documents.chips.conflict')}</Badge> : null}
      {d.duplicateOf ? <Badge tone="neutral" title={t('documents.chips.duplicateOf', { file: nameOf(d.duplicateOf) })}><Copy size={12} aria-hidden /> {t('documents.chips.duplicate')}</Badge> : null}
      {d.fromChat && mode === 'recent' ? <Badge tone="neutral"><Paperclip size={12} aria-hidden /> {t('documents.folders.fromChat')}</Badge> : null}
    </>
  );

  const fileRow = (d: DocSummary) => {
    const Icon = d.localOnly ? Lock : KIND_ICON[d.kind];
    const isFocused = focused === d.path;
    return (
      <tr
        key={d.path}
        className={cx('doc-row', isFocused && 'doc-row--focused')}
        tabIndex={isFocused || (!focused && ordered[0] === d.path) ? 0 : -1}
        aria-selected={isFocused}
        data-testid="doc-item"
        data-doc-path={d.path}
        data-kind={d.kind}
        data-private={d.localOnly ? 'true' : undefined}
        onFocus={() => setFocused(d.path)}
        onClick={() => setFocused(d.path)}
        onDoubleClick={() => open(d)}
        onKeyDown={(e) => onRowKey(e, d.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          setFocused(d.path);
          setMenu({ doc: d, at: { top: e.clientY, left: e.clientX, width: 0, height: 0 } });
        }}
      >
        <td className="doc-cell doc-cell--name">
          <div className="doc-cell__inner">
            <span className={cx('doc-icon', `doc-icon--${d.kind}`, d.localOnly && 'doc-icon--private')} aria-hidden><Icon size={17} strokeWidth={1.75} /></span>
            <span className="doc-name">
              <button type="button" className="doc-name__open" tabIndex={-1} onClick={() => open(d)}>{d.name}</button>
              {(mode === 'recent' && d.dir !== docsDir) || d.conflictOf || d.duplicateOf || (d.fromChat && mode === 'recent') ? (
                <span className="doc-name__sub">
                  {mode === 'recent' && d.dir !== docsDir ? <span className="doc-name__dir t-small t-muted">{relFolder(docsDir, d.dir).split('/').join(' › ')}</span> : null}
                  {flags(d)}
                </span>
              ) : null}
            </span>
          </div>
        </td>
        <td className="doc-cell doc-cell--num t-tabular">{pagesOf(d)}</td>
        <td className="doc-cell doc-cell--who">{d.addedBy === undefined ? '' : d.addedBy === null ? '—' : d.addedBy.self ? t('common.you') : d.addedBy.name}</td>
        <td className="doc-cell doc-cell--date t-tabular">{dateOf(d.mtimeMs)}</td>
        <td className="doc-cell doc-cell--text">{chip(d)}</td>
        <td className="doc-cell doc-cell--more">
          <IconButton
            icon={Ellipsis}
            size="sm"
            label={t('documents.menu.label', { file: d.name })}
            tabIndex={-1}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFocused(d.path);
              setMenu({ doc: d, at: { top: r.top, left: r.left, width: r.width, height: r.height } });
            }}
            data-testid="doc-more"
          />
        </td>
      </tr>
    );
  };

  const folderRow = (p: string) => {
    const isFocused = focused === p;
    const n = counts.get(p) ?? 0;
    return (
      <tr
        key={p}
        className={cx('doc-row', 'doc-row--folder', isFocused && 'doc-row--focused')}
        tabIndex={isFocused || (!focused && ordered[0] === p) ? 0 : -1}
        aria-selected={isFocused}
        data-testid="doc-folder"
        data-doc-path={p}
        onFocus={() => setFocused(p)}
        onClick={() => setFocused(p)}
        onDoubleClick={() => goFolder(p)}
        onKeyDown={(e) => onRowKey(e, p)}
      >
        <td className="doc-cell doc-cell--name">
          <div className="doc-cell__inner">
            <span className="doc-icon doc-icon--folder" aria-hidden><Folder size={17} strokeWidth={1.75} /></span>
            <span className="doc-name">
              <button type="button" className="doc-name__open" tabIndex={-1} onClick={() => goFolder(p)}>{nameOf(p)}</button>
            </span>
          </div>
        </td>
        <td className="doc-cell doc-cell--num t-muted">—</td>
        <td className="doc-cell doc-cell--who t-muted" colSpan={2}>{n ? tp('common.count.files', n) : t('documents.tab.emptyFolderShort')}</td>
        <td className="doc-cell doc-cell--text" />
        <td className="doc-cell doc-cell--more" />
      </tr>
    );
  };

  const nothing = !loading && files.length === 0 && docFolders.length === 0;
  const trail = crumbs(docsDir, folder);
  const folderEmpty = !loading && !nothing && mode === 'folders' && !filter.trim() && ordered.length === 0;
  const noMatch = !loading && !nothing && filter.trim() !== '' && ordered.length === 0;

  return (
    <section
      className="docs-tab"
      data-testid="class-documents"
      aria-label={t('classes.tabs.documents')}
      onDragEnter={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
    >
      <div className="docs-toolbar">
        <div className="docs-toolbar__start">
          <Button variant="primary" icon={Plus} onClick={() => void importer.pick(mode === 'folders' ? folder : docsDir)} data-testid="doc-add">{t('documents.tab.add')}</Button>
          <Button icon={FolderPlus} onClick={() => setModal({ kind: 'newFolder' })} data-testid="doc-new-folder">{t('documents.tab.newFolder')}</Button>
        </div>
        <div className="docs-toolbar__end">
          <SearchField ref={filterRef} value={filter} onChange={setFilter} size="sm" aria-label={t('documents.tab.filter')} placeholder={t('documents.tab.filter')} fieldClassName="docs-filter" data-testid="doc-filter" />
          <RadioGroup
            value={mode}
            onChange={setMode}
            options={[{ value: 'folders', label: t('documents.tab.view.folders') }, { value: 'recent', label: t('documents.tab.view.recent') }]}
            label={t('documents.tab.viewLabel')}
            hideLabel
            variant="segmented"
            data-testid="doc-view"
          />
        </div>
      </div>

      {mode === 'folders' ? (
        <nav className="docs-crumbs" aria-label={t('documents.tab.breadcrumb')} data-testid="doc-breadcrumb">
          <ol>
            {trail.map((c, i) => (
              <li key={c.path}>
                {i > 0 ? <ChevronRight size={14} aria-hidden className="docs-crumbs__sep" /> : null}
                {i === trail.length - 1 ? (
                  <span aria-current="page" className="docs-crumbs__here">{c.name || t('documents.folders.documents')}</span>
                ) : (
                  <button type="button" className="docs-crumbs__link" onClick={() => goFolder(c.path)} data-testid="doc-crumb" data-doc-path={c.path}>{c.name || t('documents.folders.documents')}</button>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {showSuggest ? (
        <div className="docs-suggest" data-testid="doc-suggest-folders" role="region" aria-label={t('documents.folders.suggest')}>
          <FolderPlus size={18} aria-hidden className="docs-suggest__icon" />
          <div className="docs-suggest__text">
            <strong>{t('documents.folders.suggest')}</strong>
            <span className="t-small t-secondary">{SUGGESTED_FOLDERS.map((k) => t(`documents.folders.${k}`)).join(' · ')}</span>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              for (const k of SUGGESTED_FOLDERS) await cls.documents.mkdir(t(`documents.folders.${k}`)).catch(() => undefined);
              await cls.info.setUiState({ dismissed: { ...((await cls.info.uiState()).dismissed as object ?? {}), docFolders: true } }).catch(() => undefined);
              setSuggestDismissed(true);
            }}
            data-testid="doc-suggest-create"
          >
            {t('documents.folders.create')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              setSuggestDismissed(true);
              await cls.info.setUiState({ dismissed: { ...((await cls.info.uiState()).dismissed as object ?? {}), docFolders: true } }).catch(() => undefined);
            }}
            data-testid="doc-suggest-dismiss"
          >
            {t('documents.folders.noThanks')}
          </Button>
        </div>
      ) : null}

      {nothing ? (
        <EmptyState
          icon={Files}
          title={t('documents.tab.empty.title')}
          actions={<Button variant="primary" icon={Plus} onClick={() => void importer.pick(docsDir)} data-testid="documents-empty-add">{t('documents.tab.empty.action')}</Button>}
          className="docs-empty"
          data-testid="documents-empty"
        >
          {t('documents.tab.empty.body')}
        </EmptyState>
      ) : (
        <div className="docs-table-wrap" ref={listRef} onKeyDown={onListKey} data-testid="doc-list" aria-busy={loading || undefined}>
          <table className="docs-table" aria-label={t('classes.tabs.documents')} aria-rowcount={loading ? undefined : ordered.length}>
            <colgroup>
              <col className="docs-col--name" />
              <col className="docs-col--num" />
              <col className="docs-col--who" />
              <col className="docs-col--date" />
              <col className="docs-col--text" />
              <col className="docs-col--more" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" aria-sort={sortOf('name') === 'asc' ? 'ascending' : sortOf('name') === 'desc' ? 'descending' : 'none'}>
                  <button type="button" className="docs-sort" onClick={() => sortBy('name')} disabled={mode === 'recent'} data-testid="doc-sort-name">{t('documents.tab.columns.name')}{sortMark(sortOf('name'))}</button>
                </th>
                <th scope="col" className="docs-th--num">{t('documents.tab.columns.pages')}</th>
                <th scope="col" aria-sort={sortOf('addedBy') === 'asc' ? 'ascending' : sortOf('addedBy') === 'desc' ? 'descending' : 'none'}>
                  <button type="button" className="docs-sort" onClick={() => sortBy('addedBy')} disabled={mode === 'recent'} data-testid="doc-sort-who">{t('documents.tab.columns.addedBy')}{sortMark(sortOf('addedBy'))}</button>
                </th>
                <th scope="col" aria-sort={mode === 'recent' ? 'descending' : sortOf('date') === 'asc' ? 'ascending' : sortOf('date') === 'desc' ? 'descending' : 'none'}>
                  <button type="button" className="docs-sort" onClick={() => sortBy('date')} disabled={mode === 'recent'} data-testid="doc-sort-date">{t('documents.tab.columns.date')}{sortMark(mode === 'recent' ? 'desc' : sortOf('date'))}</button>
                </th>
                <th scope="col">{t('documents.tab.columns.text')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.more')}</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="doc-row doc-row--skeleton" aria-hidden>
                  <td className="doc-cell doc-cell--name"><div className="doc-cell__inner"><span className="skeleton skeleton--icon" /><span className="skeleton" style={{ width: `${55 - i * 6}%` }} /></div></td>
                  <td className="doc-cell"><span className="skeleton skeleton--short" /></td>
                  <td className="doc-cell"><span className="skeleton skeleton--short" /></td>
                  <td className="doc-cell"><span className="skeleton skeleton--short" /></td>
                  <td className="doc-cell"><span className="skeleton" /></td>
                  <td className="doc-cell" />
                </tr>
              )) : null}
              {!loading ? rows.folders.map(folderRow) : null}
              {!loading ? rows.shared.map(fileRow) : null}
              {folderEmpty ? (
                <tr className="doc-row doc-row--empty"><td colSpan={6} className="doc-cell t-muted" data-testid="doc-folder-empty">{t('documents.tab.emptyFolder')}</td></tr>
              ) : null}
              {noMatch ? (
                <tr className="doc-row doc-row--empty"><td colSpan={6} className="doc-cell t-muted" data-testid="doc-no-match">{t('documents.tab.noMatch', { q: filter.trim() })}</td></tr>
              ) : null}
            </tbody>
            {!loading && rows.local.length ? (
              <tbody className="docs-local" data-testid="doc-private-section">
                <tr className="docs-local__head">
                  <th colSpan={6} scope="rowgroup">
                    <HardDrive size={14} aria-hidden /> {t('documents.tab.privateSection')}
                  </th>
                </tr>
                {rows.local.map(fileRow)}
              </tbody>
            ) : null}
          </table>
          {loading ? <span className="visually-hidden" role="status">{t('common.loading')}</span> : null}
        </div>
      )}

      {menu ? (
        <Menu
          open
          onClose={() => setMenu(null)}
          anchor={menu.at}
          items={menuItems(menu.doc)}
          label={t('documents.menu.label', { file: menu.doc.name })}
          data-testid="doc-menu"
        />
      ) : null}

      {modal?.kind === 'newFolder' ? (
        <NameDialog
          title={t('documents.tab.newFolder')}
          label={t('documents.tab.newFolderName')}
          initial=""
          submitLabel={t('common.create')}
          onSubmit={async (name) => {
            const p = await cls.documents.mkdir(name, mode === 'folders' ? folder : docsDir);
            focusRow(p);
          }}
          onClose={() => setModal(null)}
          testid="doc-folder-dialog"
        />
      ) : null}
      {modal?.kind === 'rename' ? (
        <NameDialog
          title={t('documents.rename.title', { file: modal.doc.name })}
          label={t('documents.rename.label')}
          initial={modal.doc.name}
          submitLabel={t('common.rename')}
          onSubmit={async (name) => {
            const p = await cls.documents.rename(modal.doc.path, name);
            focusRow(p);
          }}
          onClose={() => setModal(null)}
          testid="doc-rename-dialog"
        />
      ) : null}
      {modal?.kind === 'move' ? (
        <MoveDialog
          file={modal.doc.name}
          folders={docFolders}
          docsDir={docsDir}
          current={modal.doc.dir}
          onMove={async (dest) => {
            const doc = modal.doc;
            try {
              const p = await cls.documents.move(doc.path, dest);
              toast.show({
                message: t('documents.move.done', { folder: dest === docsDir ? t('documents.folders.documents') : nameOf(dest) }),
                action: { label: t('common.undo'), testId: 'toast-undo', run: () => cls.documents.move(p, doc.dir).then(() => undefined, (e: unknown) => toast.error(e)) },
              });
            } catch (e) {
              toast.error(e);
              throw e;
            }
          }}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'delete' ? (
        <DeleteDialog
          file={modal.doc.name}
          className={view?.name ?? ''}
          shared={shared && !modal.doc.localOnly}
          onDelete={() => void del(modal.doc)}
          onRemoveLocal={() => void cls.documents.remove(modal.doc.path, 'thisComputer').then(() => toast.show(t('documents.removeLocal.done', { file: modal.doc.name })), (e: unknown) => toast.error(e))}
          onClose={() => setModal(null)}
        />
      ) : null}
      {importer.ui}
      {dragging ? <DropOverlay classId={classId} target="documents" classLabel={view?.name ?? ''} /> : null}
    </section>
  );
}

function sortMark(dir: 'asc' | 'desc' | null) {
  if (!dir) return null;
  return <span className="docs-sort__mark" aria-hidden>{dir === 'asc' ? '↑' : '↓'}</span>;
}
