// The registries of architecture §11.4 (the file UX §0.2 names). Frozen after M0: every entry is a lazy
// import of a file owned by exactly one work package, so no two packages edit the same file.
import type { ComponentType } from 'react';
import type { ClassId, Ulid, QuestionId } from '../core/model/ids';
import type { FinishedRecording, Picked } from '../platform/types';
import type { ReadableStore } from '../services/store';
import type { AppServices } from '../services/types/common';
import type { ClassTabId, Route, SettingsSection } from '../shell/routes';

type Lazy<P> = () => Promise<{ default: ComponentType<P> }>;
export type LazyScreen<N extends Route['name']> = Lazy<{ route: Extract<Route, { name: N }>; services: AppServices }>;
export type LazyTab = Lazy<{ classId: ClassId; services: AppServices }>;
export type LazySection = Lazy<{ services: AppServices }>;
export interface DialogPropsMap {
  'new-class': {}; 'class-settings': { classId: ClassId }; leave: { classId: ClassId }; invite: { classId: ClassId };
  join: { code?: string }; record: { classId?: ClassId }; save: { recording: FinishedRecording };
  recover: { recording: FinishedRecording }; import: { classId: ClassId; picked?: Picked[] };
  model: { classId: ClassId; lectureId: Ulid }; 'exam-date': { classId: ClassId; examId?: Ulid };
  'exam-paper': { classId: ClassId; picked?: Picked[] }; 'answer-settings': { classId: ClassId; examId: Ulid; qids: QuestionId[] };
  shortcuts: {}; 'first-share': { classId: ClassId }; 'mass-delete': { classId: ClassId }; 'recently-deleted': { classId: ClassId };
}
export type DialogId = keyof DialogPropsMap;   // 'pair' is v1.1; 'ai-busy' and 'folder-missing' are inline (below)
export type LazyDialog<I extends DialogId> = Lazy<{ props: DialogPropsMap[I]; services: AppServices; close(): void }>;
export type LazyDockRow = Lazy<{ services: AppServices }>;          // renders null when it has nothing to show
export type LazyOverlay = Lazy<{ services: AppServices }>;
export interface PaletteItem {
  id: string; label: string; detail?: string; icon?: string; run(): void;
  // ── G2 (UI-DOCS, additive): what the frame renders when given (UX §3.13) ──
  kind?: string;
  /** data-testid of the row (default `palette-result`). */
  testid?: string;
  /** The class chip shown when the scope is All classes. */
  classId?: ClassId;
  /** "p. 9 · art. 18.º", "41:12", "Bruno, 2 Nov". */
  locator?: string;
  /** The snippet in the reading font, hits as [start, end) offsets (`mark.cite`). */
  snippet?: { text: string; marks: Array<[number, number]> };
  private?: boolean;
  ariaLabel?: string;
  /** Shift+Enter (a lecture opens without playing). */
  runAlt?(): void;
  shortcut?: string;
}
export interface PaletteGroup {
  id: string; label: string; items: PaletteItem[];
  // ── G2 (UI-DOCS, additive) ──
  kind?: string;
  /** All results of the group (`items` may hold only the first ones); with `more`, "Show all {n}". */
  total?: number;
  more?(): PaletteItem[];
  /** The indexing line under the input ("Still reading {n} files…"). */
  notice?: string;
  empty?: { title: string; body: string };
}
/** What the palette frame passes a provider (`classId` frozen since M0; the rest G2, additive). */
export interface PaletteSearchContext {
  classId: ClassId | null;
  /** "In {class}" (the default with a class) or "All classes" (Tab toggles it). */
  scope?: 'class' | 'all';
  includeArchived?: boolean;
  /** The router's go: rows navigate through it. */
  go?(route: Route): void;
}
export type LazyProvider = () => Promise<{ default: (s: AppServices) => {
  id: string; search(q: string, ctx: PaletteSearchContext, signal: AbortSignal): Promise<PaletteGroup[]> } }>;
export type LazyBadge = () => Promise<{ default: (s: AppServices, classId: ClassId) =>
  ReadableStore<{ count: number; tone: 'neutral' | 'info' | 'danger' } | null> }>;
export type LazyAction = () => Promise<{ default: (s: AppServices, classId: ClassId) => Promise<void> }>;

export const DIALOG_IDS: readonly DialogId[] = [
  'new-class', 'class-settings', 'leave', 'invite', 'join', 'record', 'save', 'recover', 'import', 'model', 'exam-date', 'exam-paper',
  'answer-settings', 'shortcuts', 'first-share', 'mass-delete', 'recently-deleted',
];

export const SCREENS: { [N in Route['name']]: LazyScreen<N> } = {
  today: () => import('./today/index'),
  class: () => import('./class/index'),
  lecture: () => import('./lecture/index'),
  document: () => import('./document/index'),
  note: () => import('./notes/index'),
  exam: () => import('./exam/index'),
  practice: () => import('./exam/Practice'),
  ask: () => import('./ask/index'),
  settings: () => import('./settings/index'),
};

export const CLASS_TABS: Record<ClassTabId, LazyTab> = {
  lectures: () => import('./lectures/Tab'),
  documents: () => import('./documents/Tab'),
  notes: () => import('./notes/Tab'),
  exams: () => import('./exams/Tab'),
  chat: () => import('./chat/Tab'),
  ask: () => import('./ask/Tab'),
  members: () => import('./members/Tab'),
  share: () => import('./class/ShareTab'),
};

export const SETTINGS_SECTIONS: Record<SettingsSection, LazySection> = {
  profile: () => import('./settings/ProfileSection'),
  appearance: () => import('./settings/AppearanceSection'),
  ai: () => import('./settings/AiSection'),
  transcription: () => import('./settings/TranscriptionSection'),
  sharing: () => import('./settings/SharingSection'),
  notifications: () => import('./settings/NotificationsSection'),
  storage: () => import('./settings/StorageSection'),
  privacy: () => import('./settings/PrivacySection'),
  about: () => import('./settings/AboutSection'),
};

export const DIALOGS: { [I in DialogId]: LazyDialog<I> } = {
  'new-class': () => import('./class/NewClassDialog'),
  'class-settings': () => import('./class/ClassSettingsDialog'),
  leave: () => import('./members/LeaveDialog'),
  invite: () => import('./members/InviteDialog'),
  join: () => import('./members/JoinDialog'),
  record: () => import('./record/RecordDialog'),
  save: () => import('./record/SaveDialog'),
  recover: () => import('./record/RecoverDialog'),
  import: () => import('./record/ImportDialog'),
  model: () => import('./record/ModelDialog'),
  'exam-date': () => import('./exams/ExamDateDialog'),
  'exam-paper': () => import('./exams/ExamPaperDialog'),
  'answer-settings': () => import('./exam/AnswerSettingsDialog'),
  shortcuts: () => import('./settings/ShortcutsDialog'),
  'first-share': () => import('./sync/FirstShareDialog'),
  'mass-delete': () => import('./sync/MassDeleteDialog'),
  'recently-deleted': () => import('./sync/RecentlyDeletedDialog'),
};

export const DOCK_ROWS: LazyDockRow[] = [() => import('./record/DockRow'), () => import('./record/JobRow'), () => import('./exam/DockRow')];
export const OVERLAYS: LazyOverlay[] = [
  () => import('./members/Admission'),
  () => import('./sync/Overlays'),
  () => import('./record/Recovery'),
  () => import('./members/DeepLinks'),
];
export const PALETTE_PROVIDERS: LazyProvider[] = [() => import('./search/provider')];
export const RAIL_BADGES: LazyBadge[] = [() => import('./chat/railBadge'), () => import('./record/railBadge')];
export const ACTIONS: { importDocuments: LazyAction; newNote: LazyAction } = {
  importDocuments: () => import('./documents/actions'),
  newNote: () => import('./notes/actions'),
};
export const CLASS_STATES: { folderMissing: Lazy<{ classId: ClassId; services: AppServices }> } = {
  folderMissing: () => import('./sync/FolderMissing'),
};
