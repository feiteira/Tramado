// STUB (M0) → T-AI owns this file from wave 1: exam dates, exam papers, extraction, answers and practice.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { ExamService } from './types/exams';

export function createExamService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ExamService {
  void ctx; void app; void cls;
  const no = (m: string) => () => Promise.reject(notImplemented(`ExamService.${m}`));
  return {
    list: constant({ dates: [], papers: [] }),
    open: () => constant(null),
    createUpcoming: no('createUpcoming'), updateUpcoming: no('updateUpcoming'), startImport: no('startImport'),
    draft: () => constant(null),
    saveReview: no('saveReview'), editQuestion: no('editQuestion'), addQuestion: no('addQuestion'), deleteQuestion: no('deleteQuestion'),
    answer: (_e, qids) => constant({ done: 0, total: qids.length, current: null, error: 'NOT_IMPLEMENTED' }),
    setMyAnswer: no('setMyAnswer'), setCorrect: no('setCorrect'), setMark: no('setMark'), reveal: no('reveal'), hint: no('hint'),
    practise: no('practise'), setInPractice: no('setInPractice'),
  };
}
