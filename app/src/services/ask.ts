// STUB (M0) → T-AI owns this file from wave 1: Ask threads, explain, summaries, study notes, @AI in chat.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { ClassId } from '../core/model/ids';
import type { AppContext } from './context';
import type { AppServices, ClassStore } from './types/common';
import type { AskService } from './types/ask';

export function createAskService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): AskService {
  void ctx; void app; void cls;
  const no = (m: string) => () => Promise.reject(notImplemented(`AskService.${m}`));
  return {
    threads: constant([]), thread: () => constant([]),
    ask: no('ask'), explain: no('explain'), summarize: no('summarize'), keyTerms: no('keyTerms'), annotate: no('annotate'),
    studyNotes: no('studyNotes'), askInChat: no('askInChat'), postToChat: no('postToChat'), clear: no('clear'),
  };
}
