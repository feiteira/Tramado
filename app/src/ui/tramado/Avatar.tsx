// Avatar (UX §2.11, §1.3): initials of the first and last word, in the member colour.
import React from 'react';
import { classStyle, memberColour } from '../classColor';
import { cx } from '../cx';
import { useI18n } from '../i18n';
import { PresenceDot, type PresenceState } from './PresenceDot';
import './group.css';

export interface AvatarProps {
  name: string;
  memberId: string;
  colour?: string;
  size?: 24 | 28 | 40;
  presence?: PresenceState;
  className?: string;
  'data-testid'?: string;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, memberId, colour, size = 24, presence, className, ...rest }: AvatarProps) {
  const { t } = useI18n();
  return (
    <span className={cx('cls-scope', 'avatar', className)} style={{ ...classStyle(memberColour(memberId, colour)), width: size, height: size, fontSize: size * 0.42 }} data-testid={rest['data-testid']} data-member-id={memberId}>
      <span aria-hidden>{initialsOf(name)}</span>
      {presence ? <PresenceDot state={presence} label={t(`members.dot.${presence}`)} className="avatar__presence" /> : null}
    </span>
  );
}
