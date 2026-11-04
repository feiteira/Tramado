// LevelMeter (UX §2.7, §3.6.2): five bars, 64×16 px, fast rise and a ×0.85 decay per frame (Trama), a clipping
// tick in --danger. role="meter" with the RMS level in dBFS (−60…0). The value is never announced live.
import React, { useEffect, useRef, useState } from 'react';
import type { TrackLevel } from '../../platform/types';
import { cx } from '../cx';
import './LevelMeter.css';

export interface LevelMeterProps {
  level: TrackLevel | null;
  /** Accessible name ("Microphone level"). */
  label: string;
  className?: string;
  'data-testid'?: string;
}

const BARS = 5;
const DECAY = 0.85;
/** 0..1 from dBFS (−60 → 0, 0 → 1). */
const norm = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

export function LevelMeter({ level, label, className, ...rest }: LevelMeterProps) {
  const target = level ? Math.max(norm(level.rmsDb), Math.min(1, level.peak) * 0.9) : 0;
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (target >= shownRef.current) {
      shownRef.current = target;   // fast rise
      setShown(target);
      return;
    }
    const step = () => {
      const next = Math.max(target, shownRef.current * DECAY);
      shownRef.current = next < 0.01 ? target : next;
      setShown(shownRef.current);
      frame.current = shownRef.current > target ? requestAnimationFrame(step) : null;
    };
    if (frame.current === null && typeof requestAnimationFrame === 'function') frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [target]);

  const lit = Math.ceil(shown * BARS - 0.15);
  const db = level ? Math.round(Math.max(-60, Math.min(0, level.rmsDb))) : -60;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={db}
      className={cx('level-meter', !level && 'level-meter--off', className)}
      data-testid={rest['data-testid']}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className={cx('level-meter__bar', i < lit && 'level-meter__bar--on')} style={{ height: `${30 + i * 17.5}%` }} aria-hidden />
      ))}
      <span className={cx('level-meter__clip', level?.clipping && 'level-meter__clip--on')} aria-hidden />
    </span>
  );
}
