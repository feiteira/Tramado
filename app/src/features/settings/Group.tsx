// Settings building blocks (Trama's Group/Row pattern, UX §3.14): a titled section with a card of rows, each row a
// label and hint on the left and its control on the right (stacked when narrow).
import React, { type ReactNode } from 'react';
import { cx } from '../../ui/cx';

export function Group({ id, title, description, children, testid, actions }: { id: string; title?: ReactNode; description?: ReactNode; children: ReactNode; testid?: string; actions?: ReactNode }) {
  return (
    <section className="set-group" aria-labelledby={title ? `set-${id}-title` : undefined} data-testid={testid}>
      {title || actions ? (
        <div className="set-group__head">
          {title ? <h3 className="set-group__title" id={`set-${id}-title`}>{title}</h3> : <span />}
          {actions ? <div className="set-group__actions">{actions}</div> : null}
        </div>
      ) : null}
      {description ? <p className="set-group__description">{description}</p> : null}
      <div className="set-card">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, labelId, className, stack, testid }: { label?: ReactNode; hint?: ReactNode; children?: ReactNode; labelId?: string; className?: string; stack?: boolean; testid?: string }) {
  return (
    <div className={cx('set-row', stack && 'set-row--stack', className)} data-testid={testid}>
      {label || hint ? (
        <div className="set-row__text">
          {label ? <div className="set-row__label" id={labelId}>{label}</div> : null}
          {hint ? <div className="set-row__hint">{hint}</div> : null}
        </div>
      ) : null}
      {children ? <div className="set-row__control">{children}</div> : null}
    </div>
  );
}

/** The section's root: the UX test id and the section title for screen readers (the nav shows it). */
export function SectionRoot({ testid, title, children }: { testid: string; title: string; children: ReactNode }) {
  return (
    <div className="set-section" data-testid={testid} role="region" aria-label={title}>
      <h2 className="set-section__title">{title}</h2>
      {children}
    </div>
  );
}
