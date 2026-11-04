// The Review screen (UX §3.9.6, `[exam-review]`), mandatory before any answer: "We found 6 questions. Check them before
// the AI answers. Fix any that were split or merged." The rules found (editable chips, sent to the AI as context), the
// original (PDF pages or photos, scrolled to the selected question's page) beside the question cards — number, points
// with the scale's unit, kind, text, [Split at cursor] [Merge with next] [Delete] ↑ ↓ — and "Answer {n} of: …" groups.
// Numbers must be unique and texts not empty. Undo/Redo in the top bar. [Save without answers] / [Looks right — answer
// them] (which opens Answer settings).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Combine, Group, Plus, Scissors, Trash2, Ungroup, X } from 'lucide-react';
import { newQuestionId } from '../../core/ids';
import type { ExamFile, Question } from '../../core/model/files';
import type { ClassId } from '../../core/model/ids';
import { scaleOf } from '../../services/exams';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useDialogs } from '../../shell/useDialogs';
import { useUndo } from '../../shell/undo';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { Notice } from '../../ui/components/Feedback';
import { ErrorText, Select, TextArea, TextField } from '../../ui/components/Field';
import { SplitPane } from '../../ui/components/SplitPane';
import { useToast } from '../../ui/components/Toast';
import { useI18n, type I18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import { pointsLabel, QUESTION_KINDS } from '../exams/format';
import { OriginalPreview } from './OriginalPreview';
import { add, editGroup, makeGroup, mergeNext, move, optionsText, parseOptions, problemsOf, remove, splitAt, ungroup } from './review';

type Meta = Partial<Pick<ExamFile, 'title' | 'type' | 'academicYear' | 'rules' | 'durationMin' | 'extraPoints' | 'scale'>>;

export function Review({ services, classId, draftId, examId }: { services: AppServices; classId: ClassId; draftId: string | null; examId: string | null }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { replace } = useRouter();
  const dialogs = useDialogs();
  const toast = useToast();
  const { record } = useUndo();
  const exams = services.forClass(classId).exams;
  const settings = useStore(services.ai.settings);
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === classId);
  const draft = useStore(exams.draft(draftId ?? ''));
  const raw = examId ? exams.raw(examId) : null;
  const aiOn = settings.enabled && (settings.key.set || !!settings.customHost);
  const me = services.ctx.device.get()?.deviceId ?? null;
  const importer = examId ? exams.importer(examId) : null;
  const readOnly = !!examId && (!importer || importer.deviceId !== me || !!exams.open(examId).get()?.newerFormat);

  const initial = useMemo(() => {
    const src = draft ? { questions: draft.questions, meta: draft.meta } : raw ? { questions: raw.questions, meta: raw as Partial<ExamFile> } : { questions: [], meta: {} };
    return { qs: src.questions.map((q) => ({ ...q })), rules: [...(src.meta.rules ?? [])], title: src.meta.title ?? '', scale: src.meta.scale ?? null, files: draft?.files ?? raw?.files ?? [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, examId, !!draft, !!raw]);
  const [qs, setQs] = useState<Question[]>(initial.qs);
  const [rules, setRules] = useState<string[]>(initial.rules);
  const [title, setTitle] = useState(initial.title);
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [current, setCurrent] = useState<string | null>(initial.qs.find((q) => q.kind !== 'container')?.id ?? null);
  const [busy, setBusy] = useState<'save' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupEdit, setGroupEdit] = useState<string | null>(null);
  const texts = useRef(new Map<string, HTMLTextAreaElement>());
  const qsRef = useRef(qs);
  qsRef.current = qs;

  useEffect(() => {
    setQs(initial.qs);
    setRules(initial.rules);
    setTitle(initial.title);
  }, [initial]);

  const scale = scaleOf(initial.scale);
  const unit = pointsLabel(i18n, scale, 2).replace(/^2\s*/, '');
  const problems = useMemo(() => problemsOf(qs), [qs]);
  const answerable = qs.filter((q) => q.kind !== 'container');
  const valid = problems.size === 0 && answerable.length > 0 && !readOnly;
  const page = qs.find((q) => q.id === current)?.source ?? null;

  /** A structural change, recorded for Undo/Redo (UX §3.9.6). */
  const change = useCallback((label: string, next: (qs: Question[]) => Question[]) => {
    const before = qsRef.current;
    const after = next(before);
    if (after === before) return;
    setQs(after);
    record({ label, detail: '', undo: async () => setQs(before), redo: async () => setQs(after) });
  }, [record]);
  const update = (id: string, patch: Partial<Question>) => setQs((cur) => cur.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const newId = () => {
    const used = new Set(qsRef.current.map((q) => q.id));
    let id = newQuestionId(services.ctx.rand);
    while (used.has(id)) id = newQuestionId(services.ctx.rand);
    return id;
  };

  const meta = (): Meta => ({ title: title.trim() || initial.title, rules: rules.map((r) => r.trim()).filter(Boolean) });
  const save = async (answer: boolean) => {
    if (!valid) return;
    setBusy(answer ? 'confirm' : 'save');
    setError(null);
    try {
      let id = examId;
      if (draftId) id = await exams.saveReview(draftId, qs, meta());
      else if (examId) await exams.saveQuestions(examId, qs, meta());
      if (!id) return;
      replace({ name: 'exam', classId, examId: id, mode: 'answers' });
      if (answer) dialogs.open('answer-settings', { classId, examId: id, qids: answerable.map((q) => q.id) });
      else toast.show(t('exams.review.saved'));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const top = qs.filter((q) => q.parent === null || !qs.some((x) => x.id === q.parent));
  const heading = tp('exams.review.title', answerable.length, { n: answerable.length });

  const card = (q: Question, inGroup: boolean) => {
    const p = problems.get(q.id) ?? [];
    const level = qs.filter((x) => x.parent === q.parent);
    const idx = level.indexOf(q);
    return (
      <li
        key={q.id}
        className={cx('rq', current === q.id && 'rq--current', p.length > 0 && 'rq--invalid')}
        data-testid="review-question"
        data-question-id={q.id}
        onFocusCapture={() => setCurrent(q.id)}
      >
        <div className="rq__head">
          <TextField label={t('exams.review.number')} size="sm" value={q.number} onChange={(v) => update(q.id, { number: v.slice(0, 20) })} fieldClassName="rq__number" disabled={readOnly} data-testid="review-number" />
          <TextField
            label={t('exams.review.points')}
            size="sm"
            type="number"
            min={0}
            step="0.25"
            value={q.points === null ? '' : String(q.points)}
            onChange={(v) => update(q.id, { points: v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)) })}
            trailing={<span className="rq__unit">{unit}</span>}
            fieldClassName="rq__points"
            disabled={readOnly}
            data-testid="review-points"
          />
          <Select
            label={t('exams.review.kind')}
            size="sm"
            value={q.kind === 'container' ? 'other' : q.kind}
            onChange={(v) => update(q.id, { kind: v as Question['kind'] })}
            options={QUESTION_KINDS.map((k) => ({ value: k, label: t(`exams.questionKinds.${k}`) }))}
            hint={q.kind === 'other' && draftId ? t('exams.review.checkKind') : undefined}
            fieldClassName="rq__kind"
            disabled={readOnly}
            data-testid="review-kind"
          />
          <div className="rq__move">
            <IconButton icon={ArrowUp} label={t('exams.review.up')} size="sm" disabled={readOnly || idx <= 0} onClick={() => change(t('exams.review.steps.move', { n: q.number }), (cur) => move(cur, q.id, -1))} data-testid="review-up" />
            <IconButton icon={ArrowDown} label={t('exams.review.down')} size="sm" disabled={readOnly || idx >= level.length - 1} onClick={() => change(t('exams.review.steps.move', { n: q.number }), (cur) => move(cur, q.id, 1))} data-testid="review-down" />
          </div>
        </div>
        <TextArea
          ref={(el) => {
            if (el) texts.current.set(q.id, el);
            else texts.current.delete(q.id);
          }}
          label={t('exams.review.text')}
          value={q.text}
          onChange={(v) => update(q.id, { text: v })}
          reading
          autoGrow
          minHeight={60}
          maxHeight={480}
          disabled={readOnly}
          fieldClassName="rq__text"
          data-testid="review-text"
        />
        {q.kind === 'multiple_choice' || q.options.length ? (
          <TextArea label={t('exams.review.options')} hint={t('exams.review.optionsHint')} value={optionsText(q.options)} onChange={(v) => update(q.id, { options: parseOptions(v) })} autoGrow minHeight={60} maxHeight={240} disabled={readOnly} data-testid="review-options" />
        ) : null}
        {p.map((x, i) => <ErrorText key={i}>{x.kind === 'dup' ? t('exams.review.dupNumber', { n: x.n }) : t('exams.review.emptyText')}</ErrorText>)}
        {!readOnly ? (
          <div className="rq__actions">
            <Button
              size="sm"
              variant="ghost"
              icon={Scissors}
              onClick={() => {
                const el = texts.current.get(q.id);
                // At the caret; with no caret inside the text, after the sentence nearest the middle.
                let caret = el ? el.selectionStart : 0;
                if (caret <= 0 || caret >= q.text.length) {
                  const mid = Math.floor(q.text.length / 2);
                  const ends = [...q.text.matchAll(/[.!?»)](?=\s)/g)].map((m) => m.index! + 1);
                  caret = ends.length ? ends.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : mid;
                }
                const id = newId();
                change(t('exams.review.steps.split', { n: q.number }), (cur) => splitAt(cur, q.id, caret, id));
              }}
              data-testid="review-split"
            >
              {t('exams.review.split')}
            </Button>
            <Button size="sm" variant="ghost" icon={Combine} disabled={idx >= level.length - 1} onClick={() => change(t('exams.review.steps.merge', { n: q.number }), (cur) => mergeNext(cur, q.id))} data-testid="review-merge">{t('exams.review.merge')}</Button>
            {!inGroup ? (
              <Button size="sm" variant="ghost" icon={Group} onClick={() => change(t('exams.review.steps.group', { n: q.number }), (cur) => makeGroup(cur, q.id, newId()))} data-testid="review-make-group">{t('exams.review.makeGroup')}</Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => change(t('exams.review.steps.delete', { n: q.number }), (cur) => remove(cur, q.id))} data-testid="review-delete">{t('exams.review.delete')}</Button>
          </div>
        ) : null}
      </li>
    );
  };

  const groupBox = (c: Question) => {
    const children = qs.filter((x) => x.parent === c.id);
    const editing = groupEdit === c.id;
    return (
      <li key={c.id} className="rgroup" data-testid="review-group" data-question-id={c.id}>
        <div className="rgroup__head">
          <span className="rgroup__label">{t('exams.review.group', { n: c.choose ?? children.length, list: children.map((x) => x.number).join(', ') })}</span>
          {!readOnly ? (
            <span className="rgroup__actions">
              <Button size="sm" variant="ghost" onClick={() => setGroupEdit(editing ? null : c.id)} aria-expanded={editing} data-testid="review-group-edit">{t('exams.review.editGroup')}</Button>
              <Button size="sm" variant="ghost" icon={Ungroup} onClick={() => change(t('exams.review.steps.ungroup', { n: c.number }), (cur) => ungroup(cur, c.id))} data-testid="review-group-ungroup">{t('exams.review.ungroup')}</Button>
            </span>
          ) : null}
        </div>
        {editing ? <GroupEditor qs={qs} container={c} i18n={i18n} onSave={(choose, members) => { change(t('exams.review.steps.group', { n: c.number }), (cur) => editGroup(cur, c.id, choose, members)); setGroupEdit(null); }} onCancel={() => setGroupEdit(null)} /> : null}
        <ol className="rgroup__items">{children.map((x) => card(x, true))}</ol>
      </li>
    );
  };

  const questions = (
    <div className="review__questions">
      <h2 className="review__col-title">{t('exams.review.questions')}</h2>
      <ol className="review__list">
        {top.map((q) => (q.kind === 'container' ? groupBox(q) : card(q, false)))}
      </ol>
      {!readOnly ? (
        <Button icon={Plus} onClick={() => { const id = newId(); change(t('exams.review.steps.add'), (cur) => add(cur, id)); setCurrent(id); }} data-testid="review-add">{t('exams.review.add')}</Button>
      ) : null}
    </div>
  );

  return (
    <>
      <ScreenHeader title={heading} subtitle={t('exams.review.intro')} undo={!readOnly} backTo={t('classes.tabs.exams')} />
      <div className="review" data-testid="exam-review">
        {readOnly && importer ? <Notice tone="info" data-testid="review-readonly">{t('exams.review.onlyImporter', { name: importer.memberName || importer.deviceName })}</Notice> : null}
        {!readOnly && cls?.shared ? <p className="review__shared t-small">{t('exams.review.shared')}</p> : null}
        <div className="review__meta">
          <TextField label={t('exams.paper.name')} value={title} onChange={setTitle} maxLength={200} disabled={readOnly} fieldClassName="review__title" data-testid="review-title" />
          <div className="review__rules" role="group" aria-label={t('exams.review.rules')}>
            <span className="review__rules-label">{t('exams.review.rules')}</span>
            {rules.map((r, i) => (
              editingRule === i ? (
                <TextField
                  key={i}
                  label={t('exams.review.rules')}
                  size="sm"
                  value={r}
                  autoFocus
                  maxLength={200}
                  onChange={(v) => setRules((cur) => cur.map((x, j) => (j === i ? v : x)))}
                  onBlur={() => { setEditingRule(null); setRules((cur) => cur.filter((x) => x.trim())); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                  fieldClassName="review__rule-input"
                  data-testid="review-rule-input"
                />
              ) : (
                <span key={i} className="review__rule" data-testid="review-rule">
                  <button type="button" className="review__rule-text" disabled={readOnly} onClick={() => setEditingRule(i)}>{r}</button>
                  {!readOnly ? <IconButton icon={X} size="sm" label={t('exams.review.removeRule', { rule: r })} onClick={() => setRules((cur) => cur.filter((_, j) => j !== i))} data-testid="review-rule-remove" /> : null}
                </span>
              )
            ))}
            {!readOnly ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setRules((cur) => [...cur, '']); setEditingRule(rules.length); }} data-testid="review-rule-add">{t('exams.review.addRule')}</Button> : null}
          </div>
        </div>
        <div className="review__body">
          {initial.files.length && initial.files.some((f) => /pdf|image/.test(f.mime)) ? (
            <SplitPane
              first={<OriginalPreview services={services} classId={classId} files={initial.files} page={page} />}
              second={questions}
              initial={420}
              min={240}
              max={760}
              minRest={360}
              storageKey="review"
              label={t('exams.review.resize')}
              className="review__split"
              handleTestId="review-split-handle"
            />
          ) : questions}
        </div>
        {error ? <Notice tone="danger" data-testid="review-error">{error}</Notice> : null}
        <footer className="review__foot">
          {problems.size ? <span className="review__problems t-small" role="status">{tp('exams.review.problems', problems.size, { n: problems.size })}</span> : <span />}
          <div className="review__buttons">
            <Button variant={aiOn ? 'secondary' : 'primary'} busy={busy === 'save'} disabled={!valid || busy !== null} onClick={() => void save(false)} data-testid="review-save">{t('exams.review.save')}</Button>
            {aiOn ? <Button variant="primary" icon={Check} busy={busy === 'confirm'} disabled={!valid || busy !== null} onClick={() => void save(true)} data-testid="review-confirm">{t('exams.review.confirm')}</Button> : null}
          </div>
        </footer>
      </div>
    </>
  );
}

function GroupEditor({ qs, container, i18n, onSave, onCancel }: { qs: Question[]; container: Question; i18n: I18n; onSave(choose: number, members: string[]): void; onCancel(): void }) {
  const { t } = i18n;
  const candidates = qs.filter((x) => x.kind !== 'container' && (x.parent === container.id || x.parent === null));
  const [members, setMembers] = useState<string[]>(qs.filter((x) => x.parent === container.id).map((x) => x.id));
  const [choose, setChoose] = useState(String(container.choose ?? members.length));
  return (
    <div className="rgroup__editor" data-testid="review-group-editor">
      <TextField label={t('exams.review.choose')} size="sm" type="number" min={1} max={Math.max(1, members.length)} value={choose} onChange={setChoose} data-testid="review-group-choose" />
      <fieldset className="rgroup__members">
        <legend className="field__label">{t('exams.review.members')}</legend>
        {candidates.map((c) => (
          <label key={c.id} className="rgroup__member">
            <input type="checkbox" checked={members.includes(c.id)} onChange={(e) => setMembers((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />
            <span>{c.number}</span>
            <span className="t-muted">{c.text.slice(0, 60)}</span>
          </label>
        ))}
      </fieldset>
      <div className="rgroup__editor-actions">
        <Button size="sm" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" disabled={!members.length} onClick={() => onSave(Number(choose) || 1, members)} data-testid="review-group-save">{t('common.save')}</Button>
      </div>
    </div>
  );
}

