// The strings of one prompt language (EN / PT-PT / ES). System prompts ask for `[S#]` citations (folder spec §8.15,
// critique C18) and follow the answer-language rule of `ai.answerLanguage` (architecture §13.3).

export type PromptLang = 'en' | 'pt' | 'es';

export interface PromptPack {
  lang: PromptLang;
  /** Language names as written in this language (for "Answer in {language}"). */
  languageNames: Record<PromptLang, string>;
  role: string;                               // "You are Tramado, a study assistant."
  answerInQuestionLanguage: string;
  answerIn: (language: string) => string;
  citeRule: string;                           // [S#] markers, lists and pin-points, never invent refs
  onlySources: string;
  generalAllowed: (mark: string) => string;   // general knowledge only in a final paragraph starting with `mark`
  insufficientRule: (mark: string) => string; // say so in a sentence starting with `mark`
  choiceRule: (word: string) => string;       // multiple choice / true-false: "Answer: B" on the first line
  caseTemplate: string[];                     // Problem → Applicable rules → Application → Conclusion
  caseRule: (headings: string) => string;
  examRole: string;                           // answering a past exam question for practice
  askRole: string;                            // answering a student's question about the class
  hintRole: string;                           // a hint: a guiding question, never the answer
  explainRole: Record<'simpler' | 'example' | 'translate' | 'detail' | 'exam', string>;
  concise: string;
  toolsRole: string;                          // Deep answer: search_materials / read_passage
  nudge: string;                              // the last turn of the tool loop
  expandRole: string;                         // cross-language keyword expansion (JSON)
  extractRole: string;                        // exam question extraction (JSON, schema in the prompt)
  ocrPrompt: string;                          // verbatim transcription of an exam page
  repairPrompt: (errors: string) => string;
  summaryRole: string;
  termsRole: string;
  annotateRole: string;
  studyNotesRole: string;
  /** Study notes with class documents among the sources (UI-EXAMS): cite the documents where the lecture refers to them. */
  studyNotesDocs: string;
  mergeRole: string;                          // merging partial summaries of a long lecture
  labels: {
    question: string; points: string; options: string; group: (choose: number, of: string) => string; rules: string;
    sources: string; noSources: string; transcript: string; passage: string; myAnswer: string;
    summary: string; terms: string; studyNotes: string;
    /** The heading of the class documents block of a study-notes request (UI-EXAMS). */
    documents: string;
  };
  /** Sentence openers the model is told to use; also detected (in every language) when reading answers. */
  marks: { insufficient: string; general: string; choice: string };
}
