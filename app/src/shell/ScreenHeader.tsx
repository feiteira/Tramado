// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Ported from Trama (app/src/shell/ScreenHeader.tsx), MPL-2.0; reshaped for UX §2.6.
//
// The top bar: [←] breadcrumb › h1 · subtitle, then the screen's actions, [⋯] and [?]. When the
// window is too narrow the actions wrap onto a second row rather than covering the title.
import React, { useEffect, type ReactNode } from 'react';
import { ArrowLeft, CircleHelp, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../ui/components/Button';
import { useI18n } from '../ui/i18n';
import { declareHelpTopic, routeTopic } from './helpTopic';
import { useKeyLabel } from './keys';
import { useRouter } from './router';
import type { ClassTabId, Route } from './routes';
import type { Undoable } from './undoManager';
import { useUndo } from './undo';
import { describeStep } from './undoFeedback';
import { useDialogs } from './useDialogs';
import { useAppState } from './AppState';
import { useStore } from './useStore';
import { Store } from '../services/store';
import './shell.css';

export interface ScreenHeaderProps {
  title: ReactNode;
  /** The line under the title (date · duration · who). */
  subtitle?: ReactNode;
  /** The screen's own buttons, before [⋯] and [?]. */
  actions?: ReactNode;
  /** The screen's "More" MenuButton (`[header-more]`), rendered after the actions. */
  more?: ReactNode;
  /** Undo/Redo (UX §2.6: only Notes and the exam Review screen). */
  undo?: boolean;
  /** Where Back goes, for its label ("Back to Lectures"). */
  backTo?: string;
  /** The h1 is elsewhere (the class header IS the title on the class screen). */
  hideTitle?: boolean;
}

const TAB_OF: Partial<Record<Route['name'], ClassTabId>> = { lecture: 'lectures', document: 'documents', note: 'notes', exam: 'exams', practice: 'exams' };
const NO_CLASSES = new Store<Array<{ id: string; shortName: string }>>([]);

export function ScreenHeader({ title, subtitle, actions, more, undo = false, backTo, hideTitle }: ScreenHeaderProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { route, go, back, canGoBack, previous } = useRouter();
  const dialogs = useDialogs();
  const { phase } = useAppState();
  const classes = useStore(phase.name === 'ready' ? phase.services.library.classes : NO_CLASSES);
  const topic = routeTopic(route.name);
  useEffect(() => (topic ? declareHelpTopic(topic) : undefined), [topic]);
  const tab = TAB_OF[route.name];
  const classId = 'classId' in route ? route.classId : null;
  const cls = classId ? classes.find((c) => c.id === classId) : undefined;
  const place = backTo ?? (previous ? placeName(previous, i18n, classes) : undefined);
  return (
    <header className="screen-header" data-testid="header">
      <div className="screen-header__start">
        {canGoBack ? (
          <IconButton icon={ArrowLeft} label={place ? t('app.header.backTo', { place }) : t('app.header.back')} shortcut="Alt+←" onClick={back} data-testid="header-back" />
        ) : null}
        <div className="screen-header__titles">
          {cls && tab ? (
            <nav className="screen-header__crumbs" aria-label={t('app.header.breadcrumb')} data-testid="breadcrumb">
              <button type="button" className="screen-header__crumb" onClick={() => go({ name: 'class', classId: cls.id })}>
                {cls.shortName}
              </button>
              <span aria-hidden="true" className="screen-header__sep">›</span>
              <button type="button" className="screen-header__crumb" onClick={() => go({ name: 'class', classId: cls.id, tab })}>
                {t(`classes.tabs.${tab}`)}
              </button>
            </nav>
          ) : null}
          {hideTitle ? null : (
            <h1 className="screen-header__title display" data-testid="header-title" tabIndex={-1}>
              {title}
            </h1>
          )}
          {subtitle && !hideTitle ? <div className="screen-header__subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="screen-header__end">
        {actions ? <div className="screen-header__actions">{actions}</div> : null}
        <div className="screen-header__app">
          {more}
          {undo ? <UndoRedo /> : null}
          <IconButton icon={CircleHelp} label={t('app.header.shortcuts')} shortcut="F1" onClick={() => dialogs.open('shortcuts', {})} data-testid="header-help" />
        </div>
      </div>
    </header>
  );
}

/** The words for a place Back returns to: "Today", "Settings", "Lectures" (a class's tab), "DC I" (its first tab). */
function placeName(r: Route, { t }: Pick<ReturnType<typeof useI18n>, 't'>, classes: ReadonlyArray<{ id: string; shortName: string }>): string {
  switch (r.name) {
    case 'today':
      return t('app.rail.today');
    case 'settings':
      return t('settings.title');
    case 'ask':
      return t('classes.tabs.ask');
    case 'class':
      return r.tab ? t(`classes.tabs.${r.tab}`) : classes.find((c) => c.id === r.classId)?.shortName ?? t('classes.tabs.lectures');
    default:
      return t(`classes.tabs.${TAB_OF[r.name] ?? 'lectures'}`);
  }
}

function UndoRedo() {
  const i18n = useI18n();
  const { t } = i18n;
  const key = useKeyLabel();
  const { state, undo, redo } = useUndo();
  const what = (s: { label: Undoable['label']; detail: string }) => describeStep(s, i18n) || s.detail;
  return (
    <div className="screen-header__undo" role="group">
      <IconButton
        icon={Undo2}
        label={state.undo ? `${t('common.undo')}: ${what(state.undo)}` : t('common.undo')}
        shortcut={key('Z')}
        disabled={!state.canUndo}
        onClick={() => void undo()}
        data-testid="undo"
      />
      <IconButton
        icon={Redo2}
        label={state.redo ? `${t('common.redo')}: ${what(state.redo)}` : t('common.redo')}
        shortcut={key('Z', { shift: true })}
        disabled={!state.canRedo}
        onClick={() => void redo()}
        data-testid="redo"
      />
    </div>
  );
}
