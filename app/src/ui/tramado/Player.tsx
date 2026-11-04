// Player (UX §2.11, §3.5.2): the lecture's audio bar. It plays a URL through an <audio> element (the caller
// passes the scheme URL, or a Blob URL on Linux where WebKitGTK refuses the custom scheme, AppInfo.mediaAudio),
// or drives a simulated engine with the same handle (the browser demo's FakeMedia). Stereo recordings
// (online mode: "me" left, "class" right) are down-mixed to mono so both ears hear both sides.
// The keys of UX §3.5.2 belong to the screen (focus rules); the player exposes a PlayerHandle.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Crosshair, Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from '../components/Button';
import { MenuButton } from '../components/Menu';
import { useI18n } from '../i18n';
import { cx } from '../cx';
import './Player.css';

/** UX §2.11: the handle a Player exposes (also implemented by the demo's FakeMedia). */
export interface PlayerHandle {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  skip(deltaMs: number): void;
  setRate(r: number): void;
  readonly ms: number;
  readonly playing: boolean;
}

/** A simulated engine (structural: the demo's FakeMedia satisfies it). */
export interface PlayerMedia extends PlayerHandle {
  readonly durationMs: number;
  onTime(cb: (ms: number) => void): () => void;
  onEnded(cb: () => void): () => void;
}

export const PLAYER_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export interface PlayerProps {
  /** The audio URL for <audio>; ignored when `media` is given. */
  src: string | null;
  media?: PlayerMedia | null;
  durationMs: number;
  rate: number;
  onRate(rate: number): void;
  follow: boolean;
  onFollow(on: boolean): void;
  /** Two channels: mix them to mono while playing (Web Audio). */
  downmix?: boolean;
  /** Time updates (≈ 4 Hz while playing, and after every seek). */
  onTime(ms: number, playing: boolean): void;
  /** The element could not play `src` (MediaError code): the caller may fall back to a Blob URL. */
  onMediaError?(code: number): void;
  /** Shortcut hints for the tooltips. */
  keys?: { toggle?: string; back?: string; forward?: string; follow?: string };
  /** Right side of the bar (the transcription status). */
  status?: ReactNode;
  className?: string;
}

const clampRate = (r: number) => Math.min(3, Math.max(0.5, r));
const two = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
};
/** "1:02:03", "41:12", "90" → ms; null when it is not a time. */
export function parseTyped(s: string): number | null {
  const raw = s.trim().replace(/[.,]/g, ':');
  if (!/^\d{1,5}(?::\d{1,2}){0,2}$/.test(raw)) return null;
  const p = raw.split(':').map(Number);
  if (p.length === 2 && p[1]! >= 60) return null;
  if (p.length === 3 && (p[1]! >= 60 || p[2]! >= 60)) return null;
  const secs = p.length === 1 ? p[0]! : p.length === 2 ? p[0]! * 60 + p[1]! : p[0]! * 3600 + p[1]! * 60 + p[2]!;
  return secs * 1000;
}

export const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  { src, media, durationMs, rate, onRate, follow, onFollow, downmix = false, onTime, onMediaError, keys = {}, status, className },
  ref,
) {
  const { t } = useI18n();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(durationMs);
  const [volume, setVolume] = useState(1);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const graph = useRef<{ ctx: AudioContext } | null>(null);

  useEffect(() => setDuration(media?.durationMs || durationMs), [durationMs, media]);

  // The simulated engine.
  useEffect(() => {
    if (!media) return undefined;
    media.setRate(rate);
    const offTime = media.onTime((ms) => {
      setNow(ms);
      setPlaying(media.playing);
      onTimeRef.current(ms, media.playing);
    });
    const offEnd = media.onEnded(() => setPlaying(false));
    setNow(media.ms);
    return () => {
      offTime();
      offEnd();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  useEffect(() => {
    if (media) media.setRate(rate);
    else if (audio.current) {
      audio.current.playbackRate = rate;
      audio.current.preservesPitch = true;
    }
  }, [rate, media, src]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume, src]);

  // Down-mix a stereo recording to mono (online mode records "me" and "class" on separate channels).
  const ensureGraph = useCallback(() => {
    const el = audio.current;
    if (!downmix || !el || graph.current || typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(el);
      const mono = ctx.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      source.connect(mono).connect(ctx.destination);
      graph.current = { ctx };
    } catch {
      graph.current = null;   // plays as recorded
    }
  }, [downmix]);
  useEffect(() => () => void graph.current?.ctx.close().catch(() => undefined), []);

  const position = useCallback(() => (media ? media.ms : Math.round((audio.current?.currentTime ?? 0) * 1000)), [media]);
  const isPlaying = useCallback(() => (media ? media.playing : !!audio.current && !audio.current.paused), [media]);

  const handle: PlayerHandle = {
    play() {
      if (media) return media.play();
      ensureGraph();
      void graph.current?.ctx.resume().catch(() => undefined);
      void audio.current?.play().catch(() => undefined);
    },
    pause() {
      if (media) return media.pause();
      audio.current?.pause();
    },
    toggle() {
      if (isPlaying()) handle.pause();
      else handle.play();
    },
    seek(ms) {
      const target = Math.max(0, Math.min(duration || Infinity, ms));
      if (media) return media.seek(target);
      if (audio.current) audio.current.currentTime = target / 1000;
      setNow(target);
      onTimeRef.current(target, isPlaying());
    },
    skip(delta) {
      handle.seek(position() + delta);
    },
    setRate(r) {
      onRate(clampRate(r));
    },
    get ms() {
      return position();
    },
    get playing() {
      return isPlaying();
    },
  };
  useImperativeHandle(ref, () => handle);

  const commitTyped = () => {
    const ms = parseTyped(typed);
    setEditing(false);
    if (ms !== null) handle.seek(ms);
  };

  const volIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className={cx('player', className)} data-testid="player" role="group" aria-label={t('lectures.player.label')}>
      {!media && src ? (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          crossOrigin={downmix ? 'anonymous' : undefined}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            onTimeRef.current(position(), false);
          }}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={() => Number.isFinite(audio.current?.duration) && setDuration((audio.current!.duration || 0) * 1000)}
          onTimeUpdate={() => {
            const ms = position();
            setNow(ms);
            onTimeRef.current(ms, isPlaying());
          }}
          onError={() => onMediaError?.(audio.current?.error?.code ?? 0)}
          data-testid="player-audio"
        />
      ) : null}
      <div className="player__controls">
        <button
          type="button"
          className="player__toggle"
          onClick={() => handle.toggle()}
          aria-label={playing ? t('lectures.player.pause') : t('lectures.player.play')}
          title={`${playing ? t('lectures.player.pause') : t('lectures.player.play')}${keys.toggle ? ` (${keys.toggle})` : ''}`}
          data-testid="player-toggle"
          data-playing={playing ? 'true' : 'false'}
        >
          {playing ? <Pause size={16} aria-hidden fill="currentColor" strokeWidth={1.5} /> : <Play size={16} aria-hidden fill="currentColor" strokeWidth={1.5} />}
        </button>
        <IconButton size="sm" icon={RotateCcw} label={t('lectures.player.back10')} shortcut={keys.back} onClick={() => handle.skip(-10_000)} data-testid="player-back" />
        <IconButton size="sm" icon={RotateCw} label={t('lectures.player.forward10')} shortcut={keys.forward} onClick={() => handle.skip(10_000)} data-testid="player-forward" />
        {editing ? (
          <input
            className="player__time-input t-tabular"
            autoFocus
            value={typed}
            inputMode="numeric"
            placeholder="h:mm:ss"
            aria-label={t('lectures.player.timeEdit')}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTyped();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
            data-testid="player-time-input"
          />
        ) : (
          <button
            type="button"
            className="player__time t-tabular"
            onClick={() => {
              setTyped(hms(now));
              setEditing(true);
            }}
            title={t('lectures.player.timeEdit')}
            data-testid="player-time"
          >
            <span className="visually-hidden">{t('lectures.player.timeEdit')}: </span>
            <span>{hms(now)}</span>
            <span className="player__sep" aria-hidden>
              /
            </span>
            <span className="player__total">{hms(duration)}</span>
          </button>
        )}
        {/* The button reads "1×": the group gives it its name ("Speed: 1×") for screen readers and the tooltip. */}
        <span role="group" aria-label={t('lectures.player.speed', { rate })} title={t('lectures.player.speed', { rate })} className="player__speed">
          <MenuButton
            size="sm"
            variant="ghost"
            label={`${rate}×`}
            align="start"
            items={PLAYER_RATES.map((r) => ({ id: String(r), label: `${r}×`, checked: r === rate, onSelect: () => onRate(r), testId: `player-speed-${r}` }))}
            data-testid="player-speed"
          />
        </span>
        <label className="player__volume" title={t('lectures.player.volume')}>
          {React.createElement(volIcon, { size: 16, 'aria-hidden': true, strokeWidth: 1.75 })}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label={t('lectures.player.volume')}
            aria-valuetext={`${Math.round(volume * 100)} %`}
            style={{ ['--pct' as string]: `${Math.round(volume * 100)}%` }}
            data-testid="player-volume"
          />
        </label>
        <button
          type="button"
          className={cx('player__follow', follow && 'player__follow--on')}
          aria-pressed={follow}
          onClick={() => onFollow(!follow)}
          title={keys.follow ? `${t('lectures.player.follow')} (${keys.follow})` : t('lectures.player.follow')}
          data-testid="player-follow"
        >
          <Crosshair size={14} aria-hidden strokeWidth={1.75} />
          <span>{t('lectures.player.follow')}</span>
        </button>
      </div>
      {status ? <div className="player__status">{status}</div> : null}
    </div>
  );
});
