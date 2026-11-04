// The transcript format in TS (architecture §11.1 core/transcript): build, replay, fold, render, anchor.
export { fromResult, transcriptLanguage, type FromResultContext } from './fromResult';
export { effective, findSegment, pendingOps, replay, type EditLog, type EffectiveTranscript, type ReplayInfo, type ReplayOptions } from './effective';
export { fold, type FoldContext } from './fold';
export {
  editLogPath, labelSpeakerOp, mergeOp, normalizeLabel, normalizeText, setSpeakerOp, setTextOp, splitOp, splitTime, textBase, validEditLine,
  MAX_LABEL_CHARS, MAX_SEGMENT_CHARS, type EditStamp,
} from './edits';
export { hms, paragraphs, renderMarkdown, renderText, renderVtt, vttTime, PARAGRAPH_GAP_MS, PARAGRAPH_MAX_MS, type Paragraph } from './render';
export { engineLabel, fileLang, isSpeakerId, labelOf, recordedByLabel, speakerLabel, RE_SPEAKER_ID } from './labels';
export { approxFind, mapOffset, quoteOf, reanchor, remapThroughEdit, segmentAt, segmentLocator, type AnchorStatus, type Reanchored, type SegmentLocator } from './anchors';
export { examRadar, radarLang } from './radar';
export { legalRefs, type LegalRef } from './references';
export { transcriptIndexText, transcriptUnits, type TranscriptUnit } from './units';
export { sha1Hex } from './sha1';
