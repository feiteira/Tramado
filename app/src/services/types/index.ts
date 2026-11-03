// Re-exports every service contract (architecture §11.2). Frozen after M0 (§19.1).
export * from './common';
export * from './library';
export * from './class';
export * from './sync';
export * from './chat';
export * from './lectures';
export * from './recording';
export * from './transcription';
export * from './documents';
export * from './notes';
export * from './search';
export * from './ai';
export * from './exams';
export * from './ask';
export type { DeviceRef, ClassSync, ClassView, ExamDateView, ExamKind, PinView, TranscriptionState, LectureView, Quota, ModelLabel, QuestionKind, Mark, ExamPaperView, QuestionView, AiAnswerView, ChatMessageView, ViewLocator, ViewSourceRef, ViewCitation, ClassIconName } from './viewModels';
