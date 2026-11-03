// ClassChip (UX §2.11): ClassTab sm + name; used in Today, search and the palette.
import React from 'react';
import type { ClassIconName } from '../classIcons';
import { cx } from '../cx';
import { ClassTab } from './ClassTab';

export interface ClassChipProps {
  cls: { name: string; shortName: string; color: string; icon: ClassIconName };
  short?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function ClassChip({ cls, short = false, className, ...rest }: ClassChipProps) {
  return (
    <span className={cx('class-chip', className)} data-testid={rest['data-testid']} title={cls.name}>
      <ClassTab color={cls.color} icon={cls.icon} size="sm" />
      <span className="class-chip__name">{short ? cls.shortName : cls.name}</span>
    </span>
  );
}
