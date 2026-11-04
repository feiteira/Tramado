// The Notes tab (UX §3.8, ready marker `note-list`): My notes (private, on this computer) and Class notes (shared
// Markdown files anyone in the class may edit), with "edited …", "{name} is editing" and conflicts; New note / New
// class note; a filter; the empty state.
import React, { useMemo, useRef, useState } from 'react';
import { GitCompareArrows, Lock, NotebookPen, Plus, UsersRound } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { NoteSummary } from '../../services/types/notes';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Badge, EmptyState } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { createNote, editedLabel } from './model';
import { fold } from '../../core/search/text';
import { useNavigatorRegistration } from '../search/navigate';
import './notes.css';

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  useNavigatorRegistration();
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { go } = useRouter();
  const cls = services.forClass(classId);
  const notes = useStore(cls.notes.list);
  const storeState = useStore(cls.store.state);
  const classes = useStore(services.library.classes);
  const view = classes.find((c) => c.id === classId);
  const shared = view?.shared ?? false;
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<'class' | 'private' | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const now = services.ctx.clock.now();

  const matches = (n: NoteSummary) => {
    const words = fold(filter).split(/\s+/).filter(Boolean);
    const hay = fold(n.title);
    return words.every((w) => hay.includes(w));
  };
  const mine = useMemo(() => notes.filter((n) => n.scope === 'private' && matches(n)), [notes, filter]);
  const theirs = useMemo(() => notes.filter((n) => n.scope === 'class' && matches(n)), [notes, filter]);
  const ordered = [...mine, ...theirs].map((n) => n.path);

  const open = (n: NoteSummary) => go({ name: 'note', classId, relPath: n.path, private: n.scope === 'private' });
  const create = async (scope: 'class' | 'private') => {
    setBusy(scope);
    try {
      const path = await createNote(services, classId, scope, i18n);
      go({ name: 'note', classId, relPath: path, private: scope === 'private' });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const onKey = (e: React.KeyboardEvent, n: NoteSummary) => {
    const i = ordered.indexOf(n.path);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        setFocused(next);
        listRef.current?.querySelector<HTMLElement>(`[data-doc-path="${CSS.escape(next)}"]`)?.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(n);
    }
  };

  const row = (n: NoteSummary) => {
    const isFocused = focused === n.path;
    return (
      <li key={`${n.scope}:${n.path}`}>
        <div
          role="link"
          tabIndex={isFocused || (!focused && ordered[0] === n.path) ? 0 : -1}
          className={cx('note-row', isFocused && 'note-row--focused')}
          onClick={() => open(n)}
          onFocus={() => setFocused(n.path)}
          onKeyDown={(e) => onKey(e, n)}
          data-testid="note-item"
          data-doc-path={n.path}
          data-private={n.scope === 'private' ? 'true' : 'false'}
        >
          <span className={cx('note-row__icon', n.scope === 'private' && 'note-row__icon--mine')} aria-hidden><NotebookPen size={16} strokeWidth={1.75} /></span>
          <span className="note-row__title">{n.title}</span>
          {n.conflict ? <Badge tone="warning"><GitCompareArrows size={12} aria-hidden /> {t('notes.conflictBadge')}</Badge> : null}
          <span className="note-row__meta t-small">
            {editedLabel(i18n, n.mtimeMs, now)}
            {n.editingBy.length ? <span className="note-row__editing"> · {t('notes.editing', { name: n.editingBy.join(', ') })}</span> : null}
          </span>
        </div>
      </li>
    );
  };

  const loading = storeState.status === 'loading';
  const empty = !loading && notes.length === 0;

  return (
    <section className="notes-tab" data-testid="class-notes" aria-label={t('classes.tabs.notes')}>
      <div className="notes-toolbar">
        <div className="notes-toolbar__start">
          <Button variant="primary" icon={Plus} busy={busy === 'private'} onClick={() => void create('private')} data-testid="note-new">{t('notes.new')}</Button>
          {shared ? <Button icon={Plus} busy={busy === 'class'} onClick={() => void create('class')} data-testid="note-new-class">{t('notes.newClass')}</Button> : null}
        </div>
        {!empty ? <SearchField value={filter} onChange={setFilter} size="sm" aria-label={t('notes.filter')} placeholder={t('notes.filter')} fieldClassName="notes-filter" data-testid="note-filter" /> : null}
      </div>
      {empty ? (
        <EmptyState
          icon={NotebookPen}
          title={t('notes.empty.title', { class: view?.name ?? '' })}
          className="notes-empty"
          data-testid="notes-empty"
          actions={
            <>
              <Button variant="primary" icon={Plus} onClick={() => void create('private')} data-testid="notes-empty-new">{t('notes.new')}</Button>
              {shared ? <Button icon={Plus} onClick={() => void create('class')} data-testid="notes-empty-new-class">{t('notes.newClass')}</Button> : null}
            </>
          }
        >
          {t('notes.empty.body')}
        </EmptyState>
      ) : (
        <div className="notes-list" ref={listRef} data-testid="note-list" aria-busy={loading || undefined}>
          <section className="notes-section" aria-labelledby="notes-mine">
            <h2 className="notes-section__title" id="notes-mine"><Lock size={13} aria-hidden /> {t('notes.mine')}</h2>
            {mine.length ? <ul className="notes-section__list">{mine.map(row)}</ul> : <p className="notes-section__empty t-small t-muted">{filter.trim() ? t('notes.noMatch', { q: filter.trim() }) : t('notes.sectionEmptyMine')}</p>}
          </section>
          {shared || theirs.length ? (
            <section className="notes-section" aria-labelledby="notes-class">
              <h2 className="notes-section__title" id="notes-class"><UsersRound size={13} aria-hidden /> {t('notes.class')}</h2>
              {theirs.length ? <ul className="notes-section__list">{theirs.map(row)}</ul> : <p className="notes-section__empty t-small t-muted">{filter.trim() ? t('notes.noMatch', { q: filter.trim() }) : t('notes.sectionEmptyClass')}</p>}
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
