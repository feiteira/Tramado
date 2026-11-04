// The saved exam texts and model outputs (app/test-fixtures/ai/, copied from the labs and redacted).
import { readFileSync } from 'node:fs';

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../../../test-fixtures/ai/${rel}`, import.meta.url), 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The OCR'd text of the photographed TGDC exam (critique V5/V6; dots via the "No training" chain). */
export const OCR_EXAM = (read('ocr/deny.json').response.choices[0].message.content as string);
/** The same photo read by NVIDIA super-vl. */
export const OCR_EXAM_SUPER = (read('ocr/super.json').response.choices[0].message.content as string);
/** The one-step image → JSON output that merged II.a–c (critique V6). */
export const OCR_ONE_STEP_JSON = (read('ocr/super_json.json').response.choices[0].message.content as string);
/** The typed DC I exam of openrouter-lab §5 (5 questions, 2a/2b, T/F, multiple choice). */
export const LAB_EXAM = (read('openrouter/t5_ultra_prompt_only.json').request.body.messages[1].content as string).split('Exam:\n')[1]!;
export const modelOutput = (name: string): string => read(`openrouter/${name}.json`).response.json.choices[0].message.content as string;
