// Architecture §11.2 (verbatim declarations): service contracts of the `chat` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { MemberId, Ulid } from '../../core/model/ids';
import type { MsgRef } from '../../core/model/files';
import type { Picked } from '../../platform/types';
import type { ChatMessageView, PinView } from './viewModels';
import type { ReadableStore } from '../store';

export interface ChatView { items: ChatMessageView[]; pins: PinView[]; unread: number; mentions: number; olderAvailable: boolean; newerFormatLines: number }

export interface ChatService {             // 0.1: no react/pin/hide (v1.1, §1.1); ChatView.pins is always []
  view: ReadableStore<ChatView>;
  send(input: { text: string; replyTo?: MsgRef; attachments?: Picked[] }): Promise<MsgRef>;
  edit(ref: MsgRef, text: string): Promise<void>;
  remove(ref: MsgRef): Promise<void>;                        // delete line + redaction (per-path lock, sync spec §12.3)
  thank(memberId: MemberId, lectureId: Ulid): Promise<void>;
  loadOlder(): Promise<void>; markRead(): void;
}
