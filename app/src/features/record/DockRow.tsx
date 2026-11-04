// The recording row of the dock (UX §2.7 `RecordDock`): ● REC, the class and title (opens the class), the time
// from audio frames, the live meters, the five MarkerButtons (1–4, N), Pause/Resume and Stop. Warnings replace
// the marker strip for 10 s (no sound, battery, disk, a track lost). States: recording, paused, saving, failed.
// It also owns the recording keys of UX §2.10/§3.6.3 — 1–4 and N anywhere (focus not in text, no modal) while
// recording, Ctrl/⌘+Shift+R to start (the record dialog) or stop (the Save dialog) — and the toast of the
// OS-global marker shortcuts. Renders nothing when nothing records.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDot, Pause, Play, Square, X } from 'lucide-react';
import type { MarkerKind } from '../../core/model/files';
import type { RecordingState } from '../../services/types/recording';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { useCommands } from '../../shell/useCommands';
import { useKeyLabel } from '../../shell/keys';
import { Button, IconButton } from '../../ui/components/Button';
import { ProgressBar } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { isTextEntry, modalOpen } from '../../ui/focus';
import { cx } from '../../ui/cx';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { LevelMeter } from '../../ui/tramado/LevelMeter';
import { MarkerButton } from '../../ui/tramado/MarkerButton';
import { longClock, shortClock } from '../lectures/format';
import { session } from './session';
import './record.css';

const KINDS: readonly MarkerKind[] = ['important', 'confused', 'exam', 'todo', 'note'];
const KEY_OF: Record<MarkerKind, string> = { important: '1', confused: '2', exam: '3', todo: '4', note: 'N' };
const BY_KEY: Record<string, MarkerKind> = { '1': 'important', '2': 'confused', '3': 'exam', '4': 'todo' };
const NOTICE_MS = 10_000;
const COMPACT_BELOW = 1280;
const TIGHT_BELOW = 1000;

type Warning = { key: string; text: string; check?: boolean };

export default function DockRow({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const dialogs = useDialogs();
  const { route, go } = useRouter();
  const key = useKeyLabel();
  const state = useStore(services.recording.state);
  const saving = useStore(session.saving);
  const failed = useStore(session.failed);
  const starting = useStore(session.starting);
  const classes = useStore(services.library.classes);
  const [noteAt, setNoteAt] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [popped, setPopped] = useState<MarkerKind | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  const [checkOpen, setCheckOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [tight, setTight] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  const prev = useRef<RecordingState | null>(null);
  const routeClass = 'classId' in route ? route.classId : null;

  // Announcements on state changes only (never the timer), and an end that was not ours.
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (!before && state) {
      setAnnounce(t('record.dock.announce.started'));
      session.failed.set(null);
    } else if (before && state && before.status.state !== state.status.state) {
      setAnnounce(state.status.state === 'paused' ? t('record.dock.announce.paused') : t('record.dock.announce.resumed'));
    } else if (before && !state) {
      if (!session.stopping.get()) session.failed.set({ classId: before.classId, title: before.title, recordingId: before.status.recordingId });
      session.stopping.set(false);
    }
  }, [state, t]);
  const prevSaving = useRef(saving);
  useEffect(() => {
    if (prevSaving.current && !saving) setAnnounce(t('record.dock.announce.saved'));
    prevSaving.current = saving;
  }, [saving, t]);

  // Compact marker buttons below 1280 px of main width.
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      setCompact(main.clientWidth < COMPACT_BELOW);
      setTight(main.clientWidth < TIGHT_BELOW);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    measure();
    return () => ro.disconnect();
  }, [state === null]);   // eslint-disable-line react-hooks/exhaustive-deps

  const mark = useCallback(
    async (kind: MarkerKind) => {
      const s = services.recording.state.get();
      if (!s || s.status.state === 'stopping') return;
      if (kind === 'note') {
        setNoteAt(s.status.ms);
        setNote('');
        return;
      }
      try {
        await services.recording.mark(kind);
        const at = services.recording.state.get()?.markers.at(-1)?.atMs ?? s.status.ms;
        setPopped(kind);
        setTimeout(() => setPopped(null), 400);
        toast.show({ message: t('record.dock.marked', { kind: t(`record.markers.${kind}`), time: shortClock(at) }), tone: 'success' });
      } catch (e) {
        toast.error(e);
      }
    },
    [services, t, toast],
  );
  const saveNote = async () => {
    const at = noteAt;
    const text = note.trim();
    setNoteAt(null);
    setNote('');
    if (at === null || !text) return;
    try {
      await services.recording.mark('note', text);
      toast.show({ message: t('record.dock.noteSaved', { time: shortClock(at) }), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  };
  const stop = useCallback(async () => {
    session.stopping.set(true);
    try {
      const rec = await services.recording.stop();
      dialogs.open('save', { recording: rec });
    } catch (e) {
      session.stopping.set(false);
      toast.error(e);
    }
  }, [services, dialogs, toast]);
  const startOrStop = useCallback(() => {
    if (services.recording.state.get()) void stop();
    else dialogs.open('record', routeClass ? { classId: routeClass } : {});
  }, [services, stop, dialogs, routeClass]);

  // Keys: Ctrl/⌘+Shift+R always; 1–4 and N while recording (not in text, no modal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        if (modalOpen()) return;
        e.preventDefault();
        startOrStop();
        return;
      }
      if (!services.recording.state.get() || mod || e.altKey || modalOpen() || isTextEntry(e.target)) return;
      if (BY_KEY[e.key]) {
        e.preventDefault();
        void mark(BY_KEY[e.key]!);
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void mark('note');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [services, mark, startOrStop]);

  // The OS-global marker shortcuts (Ctrl/⌘+Alt+1…4): Rust drops the marker; the app confirms it.
  useEffect(
    () =>
      services.ctx.platform.events.onShortcut((e) => {
        if (e.id !== 'marker') return;
        const s = services.recording.state.get();
        toast.show({ message: t('record.dock.marked', { kind: t(`record.markers.${e.kind}`), time: shortClock(s?.markers.at(-1)?.atMs ?? s?.status.ms ?? 0) }), tone: 'success' });
      }),
    [services, t, toast],
  );

  // Palette commands (UX §2.9 `record-toggle` and friends).
  useCommands(
    () => [
      state
        ? { id: 'record-toggle', label: t('app.commands.recordStop'), group: t('app.commands.group.record'), shortcut: key('R', { shift: true }), run: () => void stop() }
        : { id: 'record-toggle', label: t('app.commands.recordStart'), group: t('app.commands.group.record'), icon: CircleDot, shortcut: key('R', { shift: true }), run: startOrStop },
      ...(state
        ? [
            state.status.state === 'paused'
              ? { id: 'record-resume', label: t('app.commands.recordResume'), group: t('app.commands.group.record'), run: () => void services.recording.resume() }
              : { id: 'record-pause', label: t('app.commands.recordPause'), group: t('app.commands.group.record'), run: () => void services.recording.pause() },
            ...KINDS.filter((k) => k !== 'note').map((k) => ({ id: `record-mark-${k}`, label: t('app.commands.recordMark', { kind: t(`record.markers.${k}`) }), group: t('app.commands.group.record'), shortcut: KEY_OF[k], run: () => void mark(k) })),
          ]
        : []),
    ],
    [state === null, state?.status.state, t, key, stop, startOrStop, mark],
  );

  // Warnings: the recorder's codes and the tracks' errors; each shows for 10 s unless dismissed.
  const warnings: Warning[] = [];
  if (state) {
    const s = state.status;
    const mic = s.tracks.mic;
    const sys = s.tracks.system;
    if (state.warnings.includes('silentMic') || (mic && mic.silentForMs >= 15_000 && (s.ms < 120_000 || mic.silentForMs >= 120_000))) warnings.push({ key: 'silent', text: t('record.dock.silence'), check: true });
    if (state.warnings.includes('lowBattery')) warnings.push({ key: 'battery', text: t('record.dock.batteryUnknown') });
    if (state.warnings.includes('lowDisk') || (s.diskFree !== null && s.diskFree < 200e6)) warnings.push({ key: 'disk', text: t('record.dock.lowDisk') });
    if (mic?.error || state.warnings.includes('deviceLost')) warnings.push({ key: 'micOff', text: t('record.dock.micOff', { reason: t(`errors.${mic?.error ?? 'SPEECH_NO_DEVICE'}` as never) }) });
    if (sys?.error) warnings.push({ key: 'systemOff', text: t('record.dock.systemOff', { reason: t(`errors.${sys.error}` as never) }) });
  }
  const now = Date.now();
  const active = warnings.filter((w) => !dismissed.has(w.key) && (shown[w.key] === undefined || now - shown[w.key]! < NOTICE_MS));
  useEffect(() => {
    const fresh = active.filter((w) => shown[w.key] === undefined);
    if (!fresh.length) return undefined;
    setShown((m) => ({ ...m, ...Object.fromEntries(fresh.map((w) => [w.key, Date.now()])) }));
    const timer = setTimeout(() => setShown((m) => ({ ...m })), NOTICE_MS + 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.map((w) => w.key).join(',')]);
  const warning = active[0] ?? null;

  const live = <span className="visually-hidden" role="status" aria-live="polite">{announce}</span>;

  if (starting && !state) {
    const cls = classes.find((c) => c.id === starting.classId);
    return (
      <div className="dock-row dock-row--rec" role="region" aria-label={t('record.dock.region')} data-testid="record-dock" data-state="starting">
        {live}
        <span className="dock-rec">
          <span className="rec-dot rec-dot--still" aria-hidden />
          <span className="dock-rec__label">{t('record.dock.starting')}</span>
        </span>
        <span className="dock-row__title">{cls?.shortName ?? ''} · {starting.title}</span>
        <span className="dock-row__spacer" />
        <div className="dock-strip">
          {KINDS.map((k) => (
            <MarkerButton key={k} kind={k} label={t(`record.markers.${k}`)} keyHint={KEY_OF[k]} compact disabled onClick={() => undefined} />
          ))}
        </div>
      </div>
    );
  }
  if (saving && !state) {
    return (
      <div className="dock-row dock-row--rec" role="region" aria-label={t('record.dock.region')} data-testid="record-dock" data-state="saving">
        {live}
        <span className="dock-row__lead">{t('record.dock.saving')}</span>
        <ProgressBar value={null} label={t('record.dock.saving')} className="dock-row__progress" />
        <span className="dock-row__title">{saving.title}</span>
      </div>
    );
  }
  if (failed && !state) {
    const cls = classes.find((c) => c.id === failed.classId);
    return (
      <div className="dock-row dock-row--rec dock-row--failed" role="region" aria-label={t('record.dock.region')} data-testid="record-dock" data-state="failed">
        {live}
        <span className="dock-row__text" role="alert">{t('record.dock.failed', { reason: t('record.dock.failedReason') })}</span>
        <span className="dock-row__title">{cls?.shortName ?? ''} · {failed.title}</span>
        <span className="dock-row__spacer" />
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const rec = services.recording.pending.get().find((r) => r.recordingId === failed.recordingId) ?? services.recording.pending.get().find((r) => r.classId === failed.classId);
            session.failed.set(null);
            if (rec) dialogs.open('save', { recording: rec });
          }}
          data-testid="record-save-failed"
        >
          {t('record.dock.saveWhatWasRecorded')}
        </Button>
        <IconButton size="sm" icon={X} label={t('common.dismiss')} onClick={() => session.failed.set(null)} />
      </div>
    );
  }
  if (!state) return live;

  const s = state.status;
  const paused = s.state === 'paused';
  const cls = classes.find((c) => c.id === state.classId);
  const online = !!s.tracks.system;
  return (
    <div ref={rowRef} className={cx('dock-row', 'dock-row--rec', paused && 'dock-row--paused', tight && 'dock-row--tight')} role="region" aria-label={t('record.dock.region')} tabIndex={-1} data-testid="record-dock" data-state={s.state}>
      {live}
      <span className="dock-rec">
        <span className={cx('rec-dot', paused && 'rec-dot--still')} aria-hidden />
        <span className="dock-rec__label">{paused ? t('record.dock.paused') : t('record.dock.rec')}</span>
      </span>
      <button type="button" className="dock-row__class" onClick={() => go({ name: 'class', classId: state.classId, tab: 'lectures' })} title={cls?.name}>
        {cls ? <ClassTab color={cls.color} icon={cls.icon} size="sm" /> : null}
        <span className="dock-row__classname">{cls?.shortName ?? ''}</span>
        {state.title ? <span className="dock-row__title">· {state.title}</span> : null}
      </button>
      <span className="dock-row__time t-tabular" data-testid="record-time">
        {longClock(s.ms)}
      </span>
      <span className="dock-meters">
        {online ? (
          <span className="dock-meter">
            <span className="dock-meter__label">{t('record.dock.computer')}</span>
            <LevelMeter level={s.tracks.system} label={t('record.dock.computerLevel')} />
          </span>
        ) : null}
        {s.tracks.mic ? (
          <span className="dock-meter">
            <span className="dock-meter__label">{t('record.dock.mic')}</span>
            <LevelMeter level={s.tracks.mic} label={t('record.dock.micLevel')} data-testid="record-meter" />
          </span>
        ) : null}
      </span>
      <span className="dock-row__divider" aria-hidden />
      <div className="dock-strip">
        {noteAt !== null ? (
          <TextField
            autoFocus
            size="sm"
            value={note}
            onChange={setNote}
            placeholder={t('record.dock.noteLabel', { time: shortClock(noteAt) })}
            aria-label={t('record.dock.noteLabel', { time: shortClock(noteAt) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveNote();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setNoteAt(null);
              }
            }}
            onBlur={() => !note.trim() && setNoteAt(null)}
            fieldClassName="dock-note"
            data-testid="record-note-input"
          />
        ) : warning ? (
          <div className="dock-warning" role="status">
            <span className="dock-warning__text">{warning.text}</span>
            {warning.check ? (
              <Button ref={checkRef} size="sm" onClick={() => setCheckOpen(true)} data-testid="record-check-mic">
                {t('record.dock.check')}
              </Button>
            ) : null}
            <IconButton size="sm" icon={X} label={t('common.dismiss')} onClick={() => setDismissed((d) => new Set([...d, warning.key]))} />
          </div>
        ) : (
          KINDS.map((k) => (
            <MarkerButton key={k} kind={k} label={t(`record.markers.${k}`)} keyHint={KEY_OF[k]} compact={compact} tight={tight} popped={popped === k} disabled={s.state === 'stopping'} onClick={() => void mark(k)} />
          ))
        )}
      </div>
      <span className="dock-row__spacer" />
      {paused ? (
        tight ? (
          <IconButton size="sm" variant="secondary" icon={Play} label={t('record.dock.resume')} onClick={() => void services.recording.resume().catch((e: unknown) => toast.error(e))} data-testid="record-resume" />
        ) : (
          <Button size="sm" icon={Play} onClick={() => void services.recording.resume().catch((e: unknown) => toast.error(e))} data-testid="record-resume">
            {t('record.dock.resume')}
          </Button>
        )
      ) : tight ? (
        <IconButton size="sm" variant="secondary" icon={Pause} label={t('record.dock.pause')} onClick={() => void services.recording.pause().catch((e: unknown) => toast.error(e))} disabled={s.state === 'stopping'} data-testid="record-pause" />
      ) : (
        <Button size="sm" icon={Pause} onClick={() => void services.recording.pause().catch((e: unknown) => toast.error(e))} disabled={s.state === 'stopping'} data-testid="record-pause">
          {t('record.dock.pause')}
        </Button>
      )}
      <Button size="sm" variant="danger" icon={Square} onClick={() => void stop()} disabled={s.state === 'stopping'} data-testid="record-stop">
        {t('record.dock.stop')}
      </Button>
      <Popover open={checkOpen} onClose={() => setCheckOpen(false)} anchor={checkRef} side="top" padded className="dock-check">
        <div className="dock-check__body">
          <p className="dock-check__device">{s.tracks.mic?.device ?? t('record.dialog.device')}</p>
          <LevelMeter level={s.tracks.mic} label={t('record.dock.micLevel')} />
          <p className="dock-check__hint">{t('record.dock.checkHint')}</p>
        </div>
      </Popover>
    </div>
  );
}
