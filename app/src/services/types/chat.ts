// Architecture §11.2 (verbatim declarations): service contracts of the `chat` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { MemberId, Ulid } from '../../core/model/ids';
import type { MsgRef } from '../../core/model/files';
import type { Picked } from '../../platform/types';
import type { ChatMessageView, PinView } from './viewModels';
import type { ReadableStore } from '../store';

export interface ChatView { items: ChatMessageView[]; pins: PinView[]; unread: number; mentions: number; olderAvailable: boolean; newerFormatLines: number;
  // ── G2 (UI-GROUP, additive) ──
  /** False until the chat files were read once (the list shows skeletons until then). */
  loaded?: boolean;
}

/**
 * G2 (UI-GROUP): the asker's local state of an @AI question (UX §3.10.2 "@AI flow"), keyed by the question's message
 * id (`${deviceId}:${lineId}`). `working`: the answer is being made on this computer; `noKey`: AI is not set up here
 * (the message was posted, nothing was asked); `error`: the last answer failed with `code` (the error line in my
 * chat log is shown to me only, as a notice under my question).
 */
export type ChatAiLocal = { state: 'working' } | { state: 'noKey' } | { state: 'error'; code: string };

export interface ChatService {             // 0.1: no react/pin/hide (v1.1, §1.1); ChatView.pins is always []
  view: ReadableStore<ChatView>;
  send(input: { text: string; replyTo?: MsgRef; attachments?: Picked[] }): Promise<MsgRef>;
  edit(ref: MsgRef, text: string): Promise<void>;
  remove(ref: MsgRef): Promise<void>;                        // delete line + redaction (per-path lock, sync spec §12.3)
  thank(memberId: MemberId, lectureId: Ulid): Promise<void>;
  loadOlder(): Promise<void>; markRead(): void;
  // ── G2 (UI-GROUP, additive) ──
  /** The asker's local @AI states (this computer only). */
  ai: ReadableStore<Record<string, ChatAiLocal>>;
  /** [Try again] under a failed @AI answer: asks again for the same question. */
  retryAi(question: MsgRef): Promise<void>;
}
