// Check words (sync spec §25 Q1; architecture §1.2): two friendly words derived from a device ID,
// shown on both screens while someone joins so people can compare them aloud.
//   checkWords(deviceId) = ADJ[h[0]] + "-" + NOUN[h[1]],  h = SHA-256(UTF-8("tramado-check-v1|" + dashed deviceId))
// The 256 adjectives and 256 animal names are docs/spec/check-words-v1.txt (frozen; never
// translated), imported at build time. Vectors: test-vectors/check-words.json.
import wordsText from '../../../../docs/spec/check-words-v1.txt?raw';
import { sha256 } from '../util/sha256';
import type { DeviceId } from '../model/ids';

/** Parses the word list file: "ADJ <word>" and "NOUN <word>" lines, 256 of each, in order. */
export function parseCheckWords(text: string): { adj: string[]; noun: string[] } {
  const adj: string[] = [];
  const noun: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(ADJ|NOUN) ([a-z]{3,7})$/.exec(line);
    if (!m) throw new Error(`check-words: bad line "${line}"`);
    (m[1] === 'ADJ' ? adj : noun).push(m[2]!);
  }
  if (adj.length !== 256 || noun.length !== 256) throw new Error('check-words: need 256 adjectives and 256 nouns');
  return { adj, noun };
}

const WORDS = parseCheckWords(wordsText);

/** The two check words of a canonical (dashed) device ID, e.g. "brave-otter". */
export function checkWords(deviceId: DeviceId): string {
  const h = sha256(`tramado-check-v1|${deviceId}`);
  return `${WORDS.adj[h[0]!]}-${WORDS.noun[h[1]!]}`;
}
