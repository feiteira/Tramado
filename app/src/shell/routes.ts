// UX §2.1's ClassTabId, SettingsSection and Route, verbatim (architecture §11.4). Frozen after M0:
// joining, inviting, creating a class and recording are dialogs, not routes.

export type ClassTabId = 'lectures' | 'documents' | 'notes' | 'exams' | 'chat' | 'ask' | 'members' | 'share';
export type SettingsSection =
  | 'profile' | 'appearance' | 'ai' | 'transcription' | 'sharing' | 'notifications' | 'storage' | 'privacy' | 'about';
export type Route =
  | { name: 'today' }
  | { name: 'class'; classId: string; tab?: ClassTabId;          // default tab: 'lectures'
      folder?: string;                                           // documents tab: a sub-folder (relative path)
      threadId?: string; query?: string;                         // ask tab: open a thread / pre-fill a question
      lectureId?: string; docPath?: string;                      // ask tab (G2): the "This lecture" / "This document" scope chip
      messageId?: string }                                       // chat tab: scroll to and flash a message
  | { name: 'lecture'; classId: string; lectureId: string;
      at?: number;                                               // ms into the audio
      segmentId?: string; quote?: string;                        // highlight a cited passage
      play?: boolean }                                           // start playing from max(0, at − 10 000)
  | { name: 'document'; classId: string; relPath: string;        // class-relative path ("Legislação/Lei….pdf")
      sha256?: string;                                           // used to re-find a moved file (G13)
      page?: number; slide?: number; quote?: string; private?: boolean }
  | { name: 'note'; classId: string; relPath: string; private: boolean; quote?: string }
  | { name: 'exam'; classId: string; examId: string; questionId?: string;
      mode?: 'extracting' | 'review' | 'answers' | 'practice' }  // default chosen from exam state (§3.9)
  | { name: 'practice'; classId: string }                        // practise every paper of a class
  | { name: 'ask'; threadId?: string; query?: string }           // Ask across ALL classes (§3.11)
  | { name: 'settings'; section?: SettingsSection };             // default 'profile'

export const CLASS_TABS: readonly ClassTabId[] = ['lectures', 'documents', 'notes', 'exams', 'chat', 'ask', 'members', 'share'];
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['profile', 'appearance', 'ai', 'transcription', 'sharing', 'notifications', 'storage', 'privacy', 'about'];
export const ROUTE_NAMES: readonly Route['name'][] = ['today', 'class', 'lecture', 'document', 'note', 'exam', 'practice', 'ask', 'settings'];

export const isClassTabId = (s: unknown): s is ClassTabId => typeof s === 'string' && (CLASS_TABS as readonly string[]).includes(s);
export const isSettingsSection = (s: unknown): s is SettingsSection => typeof s === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(s);
