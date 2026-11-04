// The Lectures tab (UX §3.4): [● Record lecture] [Add a recording…] and the filter, the "Recording now" row,
// recordings kept on this computer and not saved as lectures yet, then the lectures grouped by week (newest
// first) with their transcript chip, my marker counts and flags. Rows: ↑/↓ move, Enter opens, Delete asks to
// delete; Ctrl/⌘+F focuses the filter. Empty, no-match and loading states.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleDot, FileHeadphone, HardDrive, Mic, MonitorSpeaker, RefreshCw, Copy as DuplicateIcon, Upload, Ellipsis } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ClassId } from '../../core/model/ids';
import type { FinishedRecording } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { LectureView, MarkerKind } from '../../services/types/viewModels';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { EmptyState } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { ContextMenu, MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { useI18n } from '../../ui/i18n';
import { isTextEntry, modalOpen } from '../../ui/focus';
import { MarkerIcon } from '../../ui/tramado/MarkerIcon';
import { useLectureActions, type LectureActions } from './actions';
import { dayMonth, duration, firstName, foldText, groupByWeek, longClock, rowDate, type WeekKey } from './format';
import { TranscriptChip } from './TranscriptionCard';
import { startImport } from '../record/importFlow';
import './lectures.css';

const KINDS: readonly MarkerKind[] = ['important', 'confused', 'exam', 'todo', 'note'];

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const i18n = useI18n();
  const { t } = i18n;
  const cls = services.forClass(classId);
  const lectures = useStore(cls.lectures.list);
  const storeState = useStore(cls.store.state);
  const classView = useStore(services.library.classes).find((c) => c.id === classId);
  const rec = useStore(services.recording.state);
  const pending = useStore(services.recording.pending).filter((r) => r.classId === classId);
  const dialogs = useDialogs();
  const actions = useLectureActions(services, classId);
  const [q, setQ] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shared = !!classView?.shared;
  const now = DateTime.fromMillis(services.ctx.clock.now());

  const shown = useMemo(() => {
    const needle = foldText(q.trim());
    return needle ? lectures.filter((l) => foldText(`${l.title} ${l.recordedBy.memberName}`).includes(needle)) : lectures;
  }, [lectures, q]);
  const groups = useMemo(() => groupByWeek(shown, now), [shown, now.toISODate()]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/⌘+F focuses the filter (UX §3.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !modalOpen()) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recordingHere = rec && rec.classId === classId ? rec : null;
  const loading = storeState.status === 'loading' && lectures.length === 0;
  const record = () => dialogs.open('record', { classId });
  const importRec = () => void startImport(services, classId, dialogs.open, t);

  const onListKey = (e: React.KeyboardEvent) => {
    if (isTextEntry(e.target)) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.lecture-row__open') ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
    }
  };

  return (
    <div className="lectures-tab" data-testid="class-lectures">
      {lectures.length === 0 && !recordingHere && pending.length === 0 && !loading ? null : (
      <div className="lectures-tab__bar">
        <Button icon={CircleDot} onClick={record} disabled={!!rec} data-testid="lectures-record">
          {t('lectures.list.record')}
        </Button>
        <Button icon={Upload} onClick={importRec} data-testid="lecture-import">
          {t('lectures.list.import')}
        </Button>
        <span className="lectures-tab__spacer" />
        {lectures.length > 0 ? (
          <SearchField ref={filterRef} size="sm" value={q} onChange={setQ} placeholder={t('lectures.list.filter')} aria-label={t('lectures.list.filter')} className="lectures-tab__filter" data-testid="lectures-filter" />
        ) : null}
      </div>
      )}
      {loading ? (
        <div className="lecture-list" aria-busy="true" data-testid="lecture-list-loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="lecture-row lecture-row--skeleton" aria-hidden>
              <span className="skeleton skeleton--icon" />
              <span className="lecture-row__main">
                <span className="skeleton skeleton--line" style={{ width: `${55 - i * 6}%` }} />
                <span className="skeleton skeleton--line skeleton--sub" style={{ width: `${30 + i * 4}%` }} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="lecture-list" data-testid="lecture-list" ref={listRef} onKeyDown={onListKey}>
          {recordingHere ? (
            <button type="button" className="lecture-recording-row" onClick={() => document.querySelector<HTMLElement>('[data-testid="record-dock"]')?.focus()} data-testid="lecture-recording-row">
              <span className="rec-dot" aria-hidden />
              <span>{t('lectures.list.recordingNow', { time: longClock(recordingHere.status.ms) })}</span>
              <span className="lecture-recording-row__title">{recordingHere.title}</span>
            </button>
          ) : null}
          {pending.map((p) => (
            <PendingRow key={p.recordingId} rec={p} now={now} onSave={() => dialogs.open('save', { recording: p })} />
          ))}
          {lectures.length === 0 && !recordingHere && pending.length === 0 ? (
            <EmptyState
              icon={Mic}
              title={t('lectures.list.empty.title')}
              actions={
                <>
                  <Button variant="primary" icon={CircleDot} onClick={record} data-testid="lectures-empty-record">
                    {t('lectures.list.empty.record')}
                  </Button>
                  <Button icon={Upload} onClick={importRec} data-testid="lectures-empty-import">
                    {t('lectures.list.empty.import')}
                  </Button>
                </>
              }
              data-testid="lectures-empty"
            >
              {t('lectures.list.empty.body')}
            </EmptyState>
          ) : null}
          {lectures.length > 0 && shown.length === 0 ? (
            <p className="lectures-tab__nomatch" role="status" data-testid="lectures-nomatch">
              {t('lectures.list.noMatch', { q: q.trim() })}
            </p>
          ) : null}
          {groups.map((g) => (
            <section key={g.key} className="lecture-group" aria-label={weekLabel(g.week, i18n)}>
              <h2 className="lecture-group__title">{weekLabel(g.week, i18n)}</h2>
              <ul className="lecture-group__rows" role="list">
                {g.items.map((l) => (
                  <li key={l.id}>
                    <LectureRow view={l} all={lectures} classId={classId} shared={shared} now={now} actions={actions} services={services} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {actions.dialogs}
    </div>
  );
}

function weekLabel(w: WeekKey, i18n: ReturnType<typeof useI18n>): string {
  if (w.kind === 'thisWeek') return i18n.t('lectures.list.thisWeek');
  if (w.kind === 'lastWeek') return i18n.t('lectures.list.lastWeek');
  return i18n.t('lectures.list.weekOf', { date: dayMonth(DateTime.fromISO(w.monday), i18n.locale) });
}

function PendingRow({ rec, now, onSave }: { rec: FinishedRecording; now: DateTime; onSave(): void }) {
  const f = useI18n();
  const { t } = f;
  return (
    <div className="lecture-row lecture-row--pending" data-testid="lecture-pending-row" data-recording-id={rec.recordingId}>
      <span className="lecture-row__icon" aria-hidden>
        <HardDrive size={18} strokeWidth={1.75} />
      </span>
      <span className="lecture-row__main">
        <span className="lecture-row__title">{rec.title}</span>
        <span className="lecture-row__meta">
          {t('lectures.list.pendingMeta', { date: rowDate(rec.startedAt, now, f), duration: duration(rec.durationMs, f) })}
        </span>
      </span>
      <Button size="sm" onClick={onSave} data-testid="lecture-pending-save">
        {t('lectures.list.pendingSave')}
      </Button>
    </div>
  );
}

interface RowProps { view: LectureView; all: readonly LectureView[]; classId: ClassId; shared: boolean; now: DateTime; actions: LectureActions; services: AppServices }

function LectureRow({ view, all, classId, shared, now, actions, services }: RowProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const recorder = view.recordedBy.self;
  const s = view.transcription;
  const done = s.kind === 'done';
  const dupOf = view.duplicateOf ? all.find((x) => x.id === view.duplicateOf) : null;
  const open = useCallback(() => go({ name: 'lecture', classId, lectureId: view.id }), [go, classId, view.id]);
  // One hint, on Rename (UX §3.4): the other recorder-only entries are simply unavailable.
  const onlyRecorder = t('lectures.list.menu.renameOnlyRecorder', { name: firstName(view.recordedBy.memberName) });
  const items = (): MenuEntry[] => [
    { id: 'open', label: t('lectures.list.menu.open'), onSelect: open, testId: 'lecture-menu-open' },
    { id: 'rename', label: t('lectures.list.menu.rename'), disabled: !recorder, hint: recorder ? undefined : onlyRecorder, onSelect: () => actions.rename(view), testId: 'lecture-menu-rename' },
    done
      ? { id: 'retranscribe', label: t('lectures.list.menu.retranscribe'), onSelect: () => void actions.retranscribe(view), testId: 'lecture-menu-retranscribe' }
      : { id: 'transcribe', label: t('lectures.list.menu.transcribe'), disabled: s.kind === 'claimed' && s.health !== 'stale' || s.kind === 'local' || s.kind === 'unavailable', onSelect: () => void (s.kind === 'claimed' ? actions.takeOver(view.id) : actions.transcribeHere(view.id)), testId: 'lecture-menu-transcribe' },
    { id: 'duplicate', label: t('lectures.list.menu.duplicate'), disabled: !recorder, onSelect: () => actions.markDuplicate(view), testId: 'lecture-menu-duplicate' },
    { kind: 'separator' },
    { id: 'deleteAudio', label: t('lectures.list.menu.deleteAudio'), disabled: !recorder || !view.audio, onSelect: () => void actions.deleteAudio(view), danger: true, testId: 'lecture-menu-delete-audio' },
    { id: 'deleteAll', label: t('lectures.list.menu.deleteAll'), disabled: !recorder, hint: recorder ? t('lectures.list.deleteKey') : undefined, onSelect: () => void actions.deleteAll(view), danger: true, testId: 'lecture-menu-delete' },
    ...(shared ? [{ id: 'removeLocal', label: t('lectures.list.menu.removeLocal'), onSelect: () => void actions.removeLocal(view), testId: 'lecture-menu-remove-local' }] : []),
    { kind: 'separator' },
    { id: 'reveal', label: t('lectures.list.menu.showInFolder'), onSelect: () => void actions.showInFolder(view), testId: 'lecture-menu-reveal' },
  ];
  const ModeIcon = view.mode === 'online' ? MonitorSpeaker : view.mode === 'import' ? FileHeadphone : Mic;
  const counts = KINDS.map((k) => ({ k, n: view.myMarkers[k] + (k === 'exam' ? view.autoExamMarks : 0), auto: k === 'exam' && view.autoExamMarks > 0 })).filter((x) => x.n > 0);
  const who = recorder ? t('common.you') : view.recordedBy.memberName;
  return (
    <ContextMenu items={items} label={view.title}>
      <div
        className="lecture-row"
        data-testid="lecture-item"
        data-lecture-id={view.id}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button:not(.lecture-row__open), [role="menu"]')) return;
          open();
        }}
        onKeyDown={(e) => {
          if (!(e.target as HTMLElement).classList.contains('lecture-row__open')) return;
          if (e.key === 'Delete' && recorder) {
            e.preventDefault();
            void actions.deleteAll(view);
          }
        }}
      >
        <span className="lecture-row__icon" aria-hidden title={view.mode === 'online' ? t('lectures.list.modeOnline') : t('lectures.list.modeRoom')}>
          <ModeIcon size={18} strokeWidth={1.75} />
        </span>
        <span className="lecture-row__main">
          <button type="button" className="lecture-row__open lecture-row__title" onClick={open} data-testid="lecture-open">
            {view.title}
          </button>
          <span className="lecture-row__meta">{t('lectures.list.meta', { date: rowDate(view.startedAt, now, i18n), duration: duration(view.durationMs, i18n), who })}</span>
        </span>
        <span className="lecture-row__flags">
          {!shared ? (
            <span className="lecture-flag" title={t('common.onlyThisComputer')}>
              <HardDrive size={14} aria-hidden strokeWidth={1.75} />
              <span className="lecture-flag__text">{t('common.onlyThisComputer')}</span>
            </span>
          ) : null}
          {shared && view.audio === null && done && view.transcription.kind === 'done' && !view.untrustedTranscript ? (
            <span className="lecture-flag">
              <HardDrive size={14} aria-hidden strokeWidth={1.75} />
              <span className="lecture-flag__text">{t('lectures.list.transcriptOnly', { name: view.recordedBy.memberName })}</span>
            </span>
          ) : null}
          {view.audio?.arriving ? (
            <span className="lecture-flag lecture-flag--info">
              <RefreshCw size={14} aria-hidden strokeWidth={1.75} />
              <span className="lecture-flag__text">{t('common.arriving')}</span>
            </span>
          ) : null}
          {dupOf ? (
            <span className="lecture-flag">
              <DuplicateIcon size={14} aria-hidden strokeWidth={1.75} />
              <span className="lecture-flag__text">{t('lectures.list.duplicateOf', { title: dupOf.title })}</span>
            </span>
          ) : null}
        </span>
        <span className="lecture-row__markers" role={counts.length ? 'img' : undefined} aria-label={counts.map((c) => `${c.n} ${t(`record.markers.${c.k}`)}`).join(', ') || undefined}>
          {counts.map((c) => (
            <span key={c.k} className={c.auto ? 'lecture-row__count lecture-row__count--auto' : 'lecture-row__count'} aria-hidden>
              <MarkerIcon kind={c.k} auto={c.auto} size={14} />
              <span className="t-tabular">{c.n}</span>
            </span>
          ))}
        </span>
        <TranscriptChip view={view} shared={shared} />
        <MenuButton size="sm" variant="ghost" iconOnly icon={Ellipsis} label={t('common.more')} align="end" items={items()} data-testid="lecture-menu" className="lecture-row__menu" />
      </div>
    </ContextMenu>
  );
}
