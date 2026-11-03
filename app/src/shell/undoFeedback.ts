import type { Undoable } from './undoManager';
import type { I18n } from '../ui/i18n';

// What an undo or redo step says (Trama's undoFeedback, simplified: Tramado's steps carry their own
// translated label). "Undo: Deleted “Aula 6.pdf”".

type Step = Pick<Undoable, 'label' | 'detail'>;
type Lang = Pick<I18n, 't'>;

/** The step as a sentence, or '' when it says nothing. */
export function describeStep(step: Step, _i18n?: Lang): string {
  return step.label || step.detail;
}

/** The toast after an undo or a redo went through. */
export function stepDoneMessage(kind: 'undo' | 'redo', step: Step, i18n: Lang): string {
  const what = describeStep(step);
  const verb = i18n.t(kind === 'undo' ? 'common.undo' : 'common.redo');
  return what ? `${verb}: ${what}` : verb;
}

/** The toast when a step was refused because what it would write back changed since. */
export function stepRefusedMessage(_kind: 'undo' | 'redo', step: Step | null, i18n: Lang): string {
  const what = step ? describeStep(step) : '';
  return what ? `${i18n.t('errors.CONFLICT')} (${what})` : i18n.t('errors.CONFLICT');
}
