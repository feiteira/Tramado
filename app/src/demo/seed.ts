// The demo seed (architecture §11.6, UX §7.3): writes the fictional example as spec-conformant files into the memory
// platform. No services: class folders (class.json, meta, members, presence, consent, chat, claims, edits, mod,
// lectures with lecture.json + audio.webm + transcript.json, documents, notes, exams with exam.json, shared
// answers), private data (my notes, highlights, markers, marks and practice, Ask threads, lecture summaries, chat
// read marker) and app files (identity, prefs). Every signed record is signed with the memory platform's test keys
// (this computer's through `platform.sync.sign`, classmates' with their own pool keys), IDs are derived (folder
// spec §2.1), and each file carries its writer's `modifiedBy` and a plausible mtime, as Syncthing would leave them.
// `transcript.md` / `.vtt` are added at G1 with T-LECTURES' renderer (plan §5).
import { fromBase64, toBase64, toHex } from '../core/bytes';
import { formatHlc } from '../core/hlc';
import { ulidFrom } from '../core/ids';
import { classIdOf, itemIdOf, newNonce } from '../core/model/derive';
import { dirsFor, type ClassDirs } from '../core/model/dirs';
import { FORMATS } from '../core/model/formats';
import { hlcNodeOf, shortIdOf, type ClassId, type DeviceId, type Hex64, type MemberId, type Ulid } from '../core/model/ids';
import { lectureDirName, sanitize } from '../core/model/sanitize';
import { canonicalBytes, personProofMessage, signedMessageFromCanonical, toBase64Url } from '../core/model/sig';
import { instant } from '../core/model/time';
import type {
  AnswersFile, Answer, AskHistoryLine, AnnotationLine, ChatLine, Citation, ClaimFile, ClassFile, ConsentLine, ExamFile, IdentityFile,
  LectureFile, MarkersFile, MarksFile, MemberFile, MetaFile, ModLine, PresenceFile, Question, Sig, TranscriptEditLine, TranscriptFile,
} from '../core/model/files';
import { mulberry32 } from '../core/util/prng';
import { sha256, sha256Hex } from '../core/util/sha256';
import type { UiLocale } from '../core/i18n/languages';
import type { MemoryPlatform } from '../platform/memory';
import { deviceIdentity, poolKey } from '../platform/memory/signer';
import { emptyDemoKeys, type DemoKeys } from './keys';
import { CLASSES } from './example';
import { demoPeaks, buildTranscript } from './example/fill';
import { FILLER } from './example/content/transcripts';
import { docSourceText } from './example/sources';
import { PEOPLE, UNVERIFIED_DEVICE } from './example/people';
import { clockLabel, clockMs, lisbon, lisbonDateTime } from './example/time';
import type { DemoAiAnswer, DemoCitation, DemoClass, DemoLecture, DemoSegment, MemberKey } from './example/types';

/** UX §7.3 (names, short names, colours, icons, lecturers, terms, languages, sharing), in rail order. */
export const DEMO_CLASSES: readonly DemoClass[] = CLASSES;

export interface SeedOptions {
  lang: UiLocale;
  theme: 'light' | 'dark';
  name: string;
  nowMs: number;
  /** `demo=empty`: only the prefs (the onboarding writes the identity). */
  empty: boolean;
  // ── T-DEMO additions (optional; demo/boot.ts passes them from the URL, UX §7.2) ──
  /** `join=ask`: `law` has "Ask before letting people in" on (Diogo's request itself is the sync fake's). */
  join?: 'ask' | null;
  /** `unverified=1`: the unverified device "Carla-PC" in `law`. */
  unverified?: boolean;
  /** `conflict=1`: a sync-conflict sibling of the class note `class8`. */
  conflict?: boolean;
  /** `ai=`: every mode but `off` has a (fictional) OpenRouter key stored, so AI shows as set up. */
  ai?: 'fake' | 'off' | 'busy' | 'quota' | 'badkey';
  /** Reads a committed binary of demo/assets/ (default: fetched next to this module, or read from disk in Node). */
  assets?: (name: string) => Promise<Uint8Array>;
}

const enc = new TextEncoder();
const MIN = 60_000;
const compact = (v: unknown) => enc.encode(JSON.stringify(v));
const pretty = (v: unknown) => enc.encode(JSON.stringify(v, null, 2) + '\n');
const jsonl = (lines: unknown[]) => enc.encode(lines.map((l) => JSON.stringify(l) + '\n').join(''));
/** UX §7.3: "Ana's laptop" (the fixture keeps its English device names in every UI language). */
const deviceNameOf = (name: string) => `${name.split(/\s+/)[0] ?? name}’s laptop`;
/** A stable 32-bit seed from a string (FNV-1a), so every nonce and ULID of the fixtures is reproducible. */
function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
const nonceOf = (what: string) => newNonce(mulberry32(seedOf(`nonce|${what}`)));
/** A reproducible random ULID (chat lines, edits, consent, answers, annotations: folder spec §2). */
const ulidOf = (ms: number, what: string) => ulidFrom(ms, sha256(`tramado-demo|${what}`).slice(0, 10));

async function sha1Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(text) as BufferSource)));
}

// ── Assets ───────────────────────────────────────────────────────────────────────────────────────────
// Literal `new URL(…, import.meta.url)`s: Vite copies (or inlines) each file into the build; Node reads them.
const ASSET_URLS: Readonly<Record<string, URL>> = {
  'lf.pdf': new URL('./assets/lf.pdf', import.meta.url),
  'slides6.pptx': new URL('./assets/slides6.pptx', import.meta.url),
  'resumo.docx': new URL('./assets/resumo.docx', import.meta.url),
  'acordao.pdf': new URL('./assets/acordao.pdf', import.meta.url),
  'calendario.pdf': new URL('./assets/calendario.pdf', import.meta.url),
  'esquemas.pdf': new URL('./assets/esquemas.pdf', import.meta.url),
  'mock.pdf': new URL('./assets/mock.pdf', import.meta.url),
  'primer.pdf': new URL('./assets/primer.pdf', import.meta.url),
  'slides3.pptx': new URL('./assets/slides3.pptx', import.meta.url),
  'lab2.docx': new URL('./assets/lab2.docx', import.meta.url),
  'cell.png': new URL('./assets/cell.png', import.meta.url),
  'apuntes.pdf': new URL('./assets/apuntes.pdf', import.meta.url),
};
export const DEMO_ASSETS: readonly string[] = Object.keys(ASSET_URLS);

/** The bytes of a committed demo asset: fetched in the browser, read from disk under Node (Vitest). */
export async function loadDemoAsset(name: string): Promise<Uint8Array> {
  const url = ASSET_URLS[name];
  if (!url) throw new Error(`demo asset ${name} does not exist`);
  if (url.protocol === 'file:') {
    const fsModule = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFile(u: URL): Promise<Uint8Array> };
    return new Uint8Array(await fs.readFile(url));
  }
  if (url.protocol === 'data:') return fromBase64(url.href.slice(url.href.indexOf(',') + 1));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`demo asset ${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * A stand-in for a lecture's `audio.webm`: an EBML/WebM header and deterministic filler, a few kilobytes. The demo
 * plays lectures with FakeMedia (demo/fakeMedia.ts) and draws the peaks of UX §7.1, so no real audio is needed;
 * `lecture.json` names its exact size and SHA-256, as the transcription rules require.
 */
export function fakeAudio(key: string, bytes = 6144): Uint8Array {
  const header = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08,
    0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02];
  const out = new Uint8Array(bytes);
  out.set(header);
  let block = sha256(`tramado-demo-audio|${key}`);
  for (let o = header.length; o < bytes; o += 32) {
    out.set(block.slice(0, Math.min(32, bytes - o)), o);
    block = sha256(block);
  }
  return out;
}

// ── Identities ───────────────────────────────────────────────────────────────────────────────────────
interface Dev { deviceId: DeviceId; memberId: MemberId; member: MemberKey; name: string; deviceName: string; pool: number }

export async function seedDemo(platform: MemoryPlatform, opts: SeedOptions): Promise<DemoKeys> {
  const keys = emptyDemoKeys();
  const prefs: Record<string, string> = { 'ui.locale': opts.lang, 'ui.theme': opts.theme, 'app.trayAsked': '1' };
  if (opts.empty) {
    await platform.appFiles.write('prefs.json', JSON.stringify(prefs, null, 2) + '\n');
    return keys;
  }
  const readAsset = opts.assets ?? loadDemoAsset;
  const assetCache = new Map<string, Promise<Uint8Array>>();
  const asset = (name: string) => {
    let p = assetCache.get(name);
    if (!p) assetCache.set(name, (p = readAsset(name)));
    return p;
  };

  // Me: the person key (memory pool) and identity.json.
  const person = await platform.person.init();
  const me = platform.mem.deviceId;
  const myName = opts.name;
  const myDeviceName = deviceNameOf(myName);
  const identity: IdentityFile = {
    format: 'tramado.identity', version: 1, memberId: person.memberId, name: myName, deviceName: myDeviceName, colour: null, personPub: person.pub,
    createdAt: instant(lisbon('2026-09-21T09:05')),
  };
  await platform.appFiles.write('identity.json', JSON.stringify(identity, null, 2) + '\n');
  if (opts.ai !== 'off') await platform.secrets.set('openrouter', 'tramado-demo-key-fictional-0000');

  const devOf = (member: MemberKey, device = 0): Dev => {
    if (member === 'ana') return { deviceId: me, memberId: person.memberId, member, name: myName, deviceName: myDeviceName, pool: 0 };
    const p = PEOPLE[member];
    const d = p.devices[device];
    if (!d) throw new Error(`${member} has no device ${device}`);
    return { deviceId: d.deviceId, memberId: p.memberId, member, name: p.name, deviceName: d.name, pool: d.pool };
  };
  for (const p of Object.values(PEOPLE)) {
    keys.members[p.key] = p.key === 'ana'
      ? { memberId: person.memberId, deviceIds: [me] }
      : { memberId: p.memberId, deviceIds: p.devices.map((d) => d.deviceId) };
  }

  const identities = new Map<number, ReturnType<typeof deviceIdentity>>();
  const identityOf = (pool: number) => {
    let id = identities.get(pool);
    if (!id) identities.set(pool, (id = deviceIdentity(pool)));
    return id;
  };
  /** Signs a record as `dev` (folder spec §6.6): this computer through the platform, classmates with their pool keys. */
  async function signAs<T extends object>(dev: Dev, classId: ClassId, path: string, record: T): Promise<T & { sig: Sig }> {
    const canonical = canonicalBytes(record as Record<string, unknown>);
    let sig: Sig;
    if (dev.deviceId === me) sig = await platform.sync.sign(classId, path, canonical);
    else {
      const id = identityOf(dev.pool);
      sig = { cert: toBase64(id.cert), value: toBase64(await id.key.sign(signedMessageFromCanonical(classId, path, canonical))) };
    }
    return { ...record, sig };
  }
  /** HLC stamps per device: the record's own time, a counter only when one device stamps the same millisecond twice. */
  const used = new Set<string>();
  const stamp = (dev: Dev, ms: number) => {
    let counter = 0;
    while (used.has(`${dev.deviceId}|${ms}|${counter}`)) counter++;
    used.add(`${dev.deviceId}|${ms}|${counter}`);
    return formatHlc({ ms, counter, device: hlcNodeOf(dev.deviceId) });
  };
  /** Writes a file as Syncthing would leave it: the writer's `modifiedBy` and the time it was written. */
  const put = (classId: ClassId, path: string, bytes: Uint8Array, by: Dev, atMs: number) =>
    platform.mem.applyRemote(classId, path, bytes, { modifiedBy: shortIdOf(by.deviceId), mtimeMs: atMs });

  // Deterministic class nonces (the class ids are the same on every run).
  const classRand = mulberry32(0x5eed);
  for (const def of DEMO_CLASSES) {
    const createdMs = lisbon(def.createdAt);
    const ana = devOf('ana');
    const nonce = newNonce(classRand);
    const classId: ClassId = classIdOf(me, nonce);
    await platform.classes.create({ classId, dirName: def.name });
    keys.classes[def.key] = classId;
    const dirs: ClassDirs = dirsFor(def.language);

    // .tramado/class.json, my meta and every member file (folder spec §8.1–§8.3).
    const classFile: ClassFile = await signAs(ana, classId, '.tramado/class.json', {
      format: 'tramado.class' as const, version: 1 as const, classId, idNonce: nonce, specVersion: '1.1' as const, createdAt: instant(createdMs),
      createdBy: { memberId: person.memberId, deviceId: me, name: myName }, initialName: def.name,
    });
    put(classId, '.tramado/class.json', pretty(classFile), ana, createdMs);
    const reg = <T>(value: T, ms = createdMs) => ({ value, hlc: stamp(ana, ms) });
    const fields: MetaFile['fields'] = {
      name: reg(def.name), shortName: reg(def.shortName), colour: reg(def.colour), icon: reg(def.icon), language: reg(def.language), dirs: reg(dirs),
      lecturer: reg(def.lecturer), term: reg(def.term),
    };
    const askMs = lisbon('2026-11-01T10:00');
    if (def.key === 'law' && opts.join === 'ask') fields.askBeforeAdmit = reg(true, askMs);
    const organiserOps = def.organisers.map((k) => ({ op: 'add' as const, memberId: devOf(k).memberId, hlc: stamp(ana, createdMs) }));
    const metaPath = `.tramado/meta/${me}.json`;
    const meta: MetaFile = await signAs(ana, classId, metaPath, {
      format: 'tramado.meta' as const, version: 1 as const, deviceId: me, memberId: person.memberId, fields, organiserOps,
      hlc: stamp(ana, fields.askBeforeAdmit ? askMs : createdMs),
    });
    put(classId, metaPath, compact(meta), ana, fields.askBeforeAdmit ? askMs : createdMs);

    const memberFile = async (dev: Dev, joinedMs: number, personPool: number | null, claimsMemberId?: MemberId) => {
      const path = `.tramado/members/${dev.deviceId}.json`;
      const memberId = claimsMemberId ?? dev.memberId;
      let proof: MemberFile['person'];
      if (personPool === null) proof = await platform.person.prove(classId);
      else {
        const pk = poolKey(personPool);
        proof = { pub: toBase64Url(pk.pub), sig: toBase64Url(await pk.sign(personProofMessage(classId, dev.deviceId, memberId))) };
      }
      const caps = dev.member === 'ana' || !PEOPLE[dev.member] ? PEOPLE.ana.caps : PEOPLE[dev.member].caps;
      const rec = await signAs(dev, classId, path, {
        format: 'tramado.member' as const, version: 1 as const, deviceId: dev.deviceId, memberId, name: dev.name, deviceName: dev.deviceName,
        joinedAt: instant(joinedMs), hlc: stamp(dev, joinedMs), addresses: [], caps: { ...caps, localModel: caps.localModel ? { ...caps.localModel } : null },
        person: proof, vouches: [], formats: { ...FORMATS }, app: { name: 'Tramado', version: '0.1.0', platform: dev.member === 'jamie' ? 'macos' : dev.member === 'carla' && dev.pool === 3 ? 'windows' : 'linux' },
      });
      put(classId, path, compact(rec), dev, joinedMs);
    };
    await memberFile(ana, createdMs, null);
    for (const m of def.members) await memberFile(devOf(m.key, m.device), lisbon(m.joinedAt), PEOPLE[m.key].personPool);
    if (def.key === 'law' && opts.unverified) {
      const u = UNVERIFIED_DEVICE;
      const carla = PEOPLE[u.claims];
      await memberFile({ deviceId: u.deviceId, memberId: carla.memberId, member: u.claims, name: carla.name, deviceName: u.name, pool: u.pool },
        lisbon('2026-11-03T09:12'), u.personPool, carla.memberId);
    }
    for (const d of [dirs.lectures, dirs.documents, dirs.exams, dirs.notes]) await platform.fs.mkdir(classId, d);

    // Consent (folder spec §8.5): class-scope `record` and `share` lines of each recorder, every line signed.
    const consentIds = new Map<MemberKey, Array<{ deviceId: DeviceId; id: Ulid }>>();
    for (const c of def.consents) {
      const dev = devOf(c.by);
      const path = `.tramado/consent/${dev.deviceId}.jsonl`;
      const ms = lisbon(c.at);
      const lines: ConsentLine[] = [];
      for (const kind of ['record', 'share'] as const) {
        const id = ulidOf(ms, `consent|${def.key}|${c.by}|${kind}`);
        lines.push(await signAs(dev, classId, path, {
          format: 'tramado.consent' as const, version: 1 as const, id, hlc: stamp(dev, ms), ms, memberId: dev.memberId, kind, scope: 'class' as const,
          ...(kind === 'share' ? { share: 'audio+transcript' as const } : {}),
          textId: kind === 'record' ? 'record.dialog.consent.v1' : 'record.dialog.consentShare.v1', textLang: 'en',
          text: kind === 'record' ? 'The lecturer agreed to this lecture being recorded.' : 'The lecturer agreed to sharing it with this class group.',
          ...(def.lecturer ? { lecturer: def.lecturer } : {}),
        }));
        consentIds.set(c.by, [...(consentIds.get(c.by) ?? []), { deviceId: dev.deviceId, id }]);
      }
      put(classId, path, jsonl(lines), dev, ms);
    }

    // Documents (any member may write them; `modifiedBy` is who added each, UX §3.7.1 "Added by").
    const docPaths = new Map<string, { path: string; sha256: Hex64; name: string }>();
    const localIgnores: string[] = [];
    for (const doc of def.documents) {
      const bytes = await asset(doc.asset);
      const path = `${dirs.documents}/${doc.path}`;
      put(classId, path, bytes, devOf(doc.addedBy), lisbon(doc.addedAt));
      docPaths.set(doc.key, { path, sha256: sha256Hex(bytes), name: doc.path.slice(doc.path.lastIndexOf('/') + 1) });
      keys.docs[doc.key] = { classKey: def.key, relPath: path };
      if (doc.localOnly) localIgnores.push(path);
    }

    // Lectures (folder spec §8.6–§8.10).
    const lectures = new Map<string, { id: Ulid; dir: string; audioSha256: Hex64; segments: DemoSegment[]; lecture: DemoLecture }>();
    for (const l of def.lectures) {
      const rec = devOf(l.recordedBy);
      const startMs = lisbon(l.startedAt);
      const endMs = startMs + l.durationMs;
      const idNonce = nonceOf(`lecture|${l.key}`);
      const id = itemIdOf(startMs, rec.deviceId, idNonce);
      const dir = `${dirs.lectures}/${lectureDirName(startMs, l.title, 'Europe/Lisbon')}`;
      const audio = fakeAudio(l.key);
      const audioSha256 = sha256Hex(audio);
      const publishedMs = endMs + 2 * MIN;
      const stereo = l.channels.length === 2;
      const lectureFile: LectureFile = {
        format: 'tramado.lecture', version: 1, id, idNonce, title: l.title, startedAt: instant(startMs), durationMs: l.durationMs, mode: l.mode, language: l.language,
        recordedBy: { memberId: rec.memberId, deviceId: rec.deviceId, name: rec.name },
        audio: { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: stereo ? 2 : 1, bitrate: stereo ? 32000 : 24000, size: audio.length, sha256: audioSha256 },
        channels: l.channels, pauses: [], consent: consentIds.get(l.recordedBy) ?? [], updatedAt: instant(publishedMs),
      };
      put(classId, `${dir}/lecture.json`, pretty(lectureFile), rec, publishedMs);
      put(classId, `${dir}/audio.webm`, audio, rec, publishedMs);
      await platform.cache.write(`peaks/${audioSha256}-1200.json`, compact({ format: 'tramado.peaks', version: 1, buckets: demoPeaks(1200) }));

      let segments: DemoSegment[] = [];
      if (l.transcript) {
        const t = l.transcript;
        const owner = devOf(t.by, t.device);
        const speaker = l.speakers[0]?.id ?? 'lecture';
        segments = buildTranscript({
          key: l.key, durationMs: l.durationMs, keys: t.keySegments, speaker, fillerSpeaker: t.filler.speaker, sentences: FILLER[t.filler.lang], seed: t.filler.seed,
        }).map((s) => (t.original?.[s.id] !== undefined ? { ...s, text: t.original[s.id]! } : s));
        const atMs = lisbon(t.at);
        const transcript: TranscriptFile = {
          format: 'tramado.transcript', version: 1, lectureId: id, round: 1, revision: t.revision, audioSha256, language: l.language,
          writer: { deviceId: owner.deviceId, memberId: owner.memberId },
          transcribedBy: { deviceId: owner.deviceId, memberId: owner.memberId, name: owner.name, at: instant(atMs) },
          engine: { kind: 'local', name: 'whisper.cpp', version: '1.8.3', model: t.model === 'turbo' ? 'ggml-large-v3-turbo-q5_0' : `ggml-${t.model}`, modelId: t.model, vad: 'silero-v5.1.2' },
          speakers: l.speakers, segments: segments.map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, speaker: s.speaker, text: s.text })),
          folded: {}, updatedAt: instant(atMs),
        };
        put(classId, `${dir}/transcript.json`, compact(transcript), owner, atMs);
      }
      if (l.claim) {
        const c = l.claim;
        const dev = devOf(c.by, c.device);
        const done = c.status === 'done';
        const claimedAt = publishedMs + 30_000;
        const doneMs = l.transcript ? lisbon(l.transcript.at) : opts.nowMs - MIN;
        const claim: ClaimFile = {
          format: 'tramado.claim', version: 1, kind: 'transcribe', lectureId: id, round: 1, deviceId: dev.deviceId, memberId: dev.memberId, claimedAt,
          status: c.status, heartbeat: c.heartbeat, updatedAt: instant(done ? doneMs : opts.nowMs - MIN), audioSha256, engine: { kind: 'local', model: dev.member === 'ana' ? PEOPLE.ana.caps.localModel?.id ?? 'turbo' : PEOPLE[dev.member].caps.localModel?.id ?? 'turbo' },
          ...(done ? { progress: 1, finishedAt: instant(doneMs), transcriptRevision: l.transcript?.revision ?? 1 } : { progress: c.progress ?? 0, ...(c.etaMs !== undefined ? { etaMs: c.etaMs } : {}) }),
        };
        put(classId, `.tramado/claims/${id}/${dev.deviceId}.json`, compact(claim), dev, done ? doneMs : opts.nowMs - MIN);
      }
      for (const e of l.edits ?? []) {
        const dev = devOf(e.by, e.device);
        const ms = lisbon(e.at);
        const before = segments.find((s) => s.id === e.segment);
        if (!before) throw new Error(`edit of a missing segment ${e.segment}`);
        const line: TranscriptEditLine = {
          format: 'tramado.transcript-edit', version: 1, id: ulidOf(ms, `edit|${l.key}|${e.segment}`), hlc: stamp(dev, ms), ms, memberId: dev.memberId, lectureId: id,
          round: 1, baseRevision: l.transcript?.revision ?? 1, op: 'set_text', segment: e.segment, base: await sha1Hex(before.text), text: e.text,
        };
        put(classId, `.tramado/edits/${id}/${dev.deviceId}.jsonl`, jsonl([line]), dev, ms);
      }
      // Effective texts (with pending corrections) are what citations quote.
      const effective = segments.map((s) => {
        const e = (l.edits ?? []).filter((x) => x.segment === s.id).at(-1);
        return e ? { ...s, text: e.text } : s;
      });
      lectures.set(l.key, { id, dir, audioSha256, segments: effective, lecture: l });
      const cite = l.cite ? effective.find((s) => s.id === l.cite!.segment) : undefined;
      keys.lectures[l.key] = {
        classKey: def.key, lectureId: id,
        ...(cite && l.cite ? { citeAtMs: cite.startMs, citeSegmentId: cite.id, citeQuote: l.cite.quote } : {}),
      };
    }

    // Citations by demo keys → folder spec §8.15 objects (paths, hashes, locators, quote context).
    const quoteOf = (text: string, exact: string) => {
      const at = text.indexOf(exact);
      if (at < 0) throw new Error(`quote not found: “${exact}”`);
      const lineStart = text.lastIndexOf('\n', at) + 1;
      const nl = text.indexOf('\n', at + exact.length);
      const lineEnd = nl < 0 ? text.length : nl;
      return { exact, prefix: text.slice(Math.max(lineStart, at - 32), at), suffix: text.slice(at + exact.length, Math.min(lineEnd, at + exact.length + 32)) };
    };
    const citation = (c: DemoCitation): Citation => {
      if (c.source.kind === 'lecture') {
        const lec = lectures.get(c.source.lecture);
        const seg = lec?.segments.find((s) => s.id === (c.source as { segment: string }).segment);
        if (!lec || !seg) throw new Error(`citation of a missing segment ${c.source.lecture}/${c.source.segment}`);
        const q = quoteOf(seg.text, c.quote);
        const start = seg.text.indexOf(c.quote);
        return {
          ref: c.ref, source: { kind: 'lecture', lectureId: lec.id, audioSha256: lec.audioSha256, transcriptRevision: lec.lecture.transcript?.revision ?? 1 },
          locator: { type: 'segment', segmentId: seg.id, startMs: seg.startMs, endMs: seg.endMs, charStart: start, charEnd: start + c.quote.length },
          quote: q, ...(c.pin ? { pin: c.pin } : {}), label: `${lec.lecture.title.split(' — ')[0]} · ${clockLabel(seg.startMs)}`,
        };
      }
      const doc = docPaths.get(c.source.doc);
      if (!doc) throw new Error(`citation of a missing document ${c.source.doc}`);
      const loc = c.source.locator;
      const page = loc.type === 'slide' ? null : loc.page;
      const text = docSourceText(c.source.doc, loc.type === 'slide' ? loc.slide : loc.page);
      const locator: Citation['locator'] = loc.type === 'article' ? { type: 'article', article: loc.article, pages: [loc.page, loc.page] } : loc.type === 'slide' ? { type: 'slide', slide: loc.slide } : { type: 'page', page: loc.page };
      const where = loc.type === 'slide' ? `slide ${loc.slide}` : `p. ${page}`;
      return {
        ref: c.ref, source: { kind: 'document', path: doc.path, sha256: doc.sha256 }, locator, quote: quoteOf(text, c.quote), ...(c.pin ? { pin: c.pin } : {}),
        label: `${doc.name} · ${where}${loc.type === 'article' ? ` · art. ${loc.article}` : ''}`,
      };
    };
    const unverifiedRanges = (a: DemoAiAnswer): Array<[number, number]> => (a.unverified ?? []).map((s) => {
      const at = a.text.indexOf(s);
      if (at < 0) throw new Error(`unverified sentence not in the answer: ${s}`);
      return [at, at + s.length];
    });

    // Exams (folder spec §8.12, §8.14) and my private marks (architecture §13.2).
    for (const ex of def.exams) {
      const importer = devOf(ex.importedBy);
      const createdMs = lisbon(ex.createdAt);
      const idNonce = nonceOf(`exam|${ex.key}`);
      const id = itemIdOf(createdMs, importer.deviceId, idNonce);
      const dir = `${dirs.exams}/${sanitize(ex.title, 'Exam')}`;
      const qid = (key: string | null) => (key === null ? null : ex.questions.find((q) => q.key === key)?.id ?? null);
      const files: ExamFile['files'] = [];
      if (ex.file) {
        const bytes = await asset(ex.file.asset);
        const path = `${dir}/${ex.file.name}`;
        put(classId, path, bytes, importer, createdMs);
        files.push({ path, sha256: sha256Hex(bytes), size: bytes.length, mime: ex.file.mime, pages: ex.file.pages });
      }
      const questions: Question[] = ex.questions.map((q) => ({
        id: q.id, number: q.number, parent: qid(q.parent), group: q.group, kind: q.kind, text: q.text, points: q.points, options: q.options ?? [],
        choose: q.choose ?? null, source: files[0] && q.page ? { file: files[0].path, page: q.page } : null, answerKey: null,
      }));
      const reviewedMs = ex.extraction ? lisbon(ex.extraction.reviewedAt) : createdMs;
      const exam: ExamFile = {
        format: 'tramado.exam', version: 1, id, idNonce, title: ex.title, type: ex.type, status: ex.status,
        date: ex.date ? lisbonDateTime(ex.date) : null, allDay: ex.allDay ?? false, durationMin: ex.durationMin ?? null, room: ex.room ?? null,
        weight: ex.weight ?? null, weightText: ex.weightText ?? null, covers: [], coversText: ex.coversText ?? null, rules: ex.rules ?? [],
        scale: ex.scale ?? null, ...(ex.extraPoints ? { extraPoints: ex.extraPoints } : {}), files,
        importedBy: { memberId: importer.memberId, deviceId: importer.deviceId, name: importer.name }, createdAt: instant(createdMs),
        extraction: ex.extraction ? {
          method: ex.extraction.method, ...(ex.extraction.model ? { model: ex.extraction.model } : {}), at: instant(lisbon(ex.extraction.at)),
          reviewedAt: instant(reviewedMs), reviewedBy: importer.memberId,
        } : null,
        questions, revision: 1, folded: {}, updatedAt: instant(reviewedMs),
      };
      put(classId, `${dir}/exam.json`, pretty(exam), importer, reviewedMs);
      keys.exams[ex.key] = { classKey: def.key, examId: id, questions: Object.fromEntries(ex.questions.map((q) => [q.key, q.id])) };

      // Shared AI answers: one file per asking device (folder spec §8.14).
      const byDevice = new Map<string, { dev: Dev; answers: Answer[]; last: number }>();
      for (const q of ex.questions) {
        if (!q.answer) continue;
        const a = q.answer;
        const dev = devOf(a.by);
        const ms = lisbon(a.at);
        const answer: Answer = {
          id: ulidOf(ms, `answer|${ex.key}|${q.key}`), questionId: q.id, questionSha1: await sha1Hex(q.text), examRevision: 1, hlc: stamp(dev, ms), at: instant(ms),
          text: a.text, citations: a.citations.map(citation), ...(a.choice ? { choice: a.choice } : {}), generalKnowledge: unverifiedRanges(a),
          model: a.model, requestedModel: a.requestedModel, privacy: 'no-training', mode: 'quick', scope: a.scope,
          usage: { promptTokens: 3_000 + a.text.length, completionTokens: Math.round(a.text.length / 3.5), reasoningTokens: 400 },
        };
        const e = byDevice.get(dev.deviceId) ?? { dev, answers: [], last: 0 };
        e.answers.push(answer);
        e.last = Math.max(e.last, ms);
        byDevice.set(dev.deviceId, e);
      }
      for (const { dev, answers, last } of byDevice.values()) {
        const file: AnswersFile = { format: 'tramado.answers', version: 1, examId: id, deviceId: dev.deviceId, memberId: dev.memberId, hlc: stamp(dev, last), updatedAt: instant(last), answers };
        put(classId, `.tramado/answers/${id}/${dev.deviceId}.json`, compact(file), dev, last);
      }

      // My private marks, drafts and practice (architecture §13.2).
      const marks: MarksFile = { format: 'tramado.exam-private', version: 1, myAnswers: {}, correct: {}, marks: {}, revealed: {}, inPractice: {}, hints: {}, practice: {} };
      let any = false;
      for (const q of ex.questions) {
        const m = q.mine;
        if (!m) continue;
        any = true;
        if (m.draft) marks.myAnswers[q.id] = m.draft;
        if (m.correct) marks.correct[q.id] = m.correct;
        if (m.mark) marks.marks[q.id] = m.mark;
        if (m.revealed) marks.revealed[q.id] = true;
        if (m.inPractice) marks.inPractice[q.id] = true;
        if (m.practice) marks.practice[q.id] = { last: instant(lisbon(m.practice.last)), result: m.practice.result, count: m.practice.count };
      }
      if (any) await platform.privateFiles.write(classId, `exams/${id}.json`, pretty(marks));
    }

    // Chat (folder spec §8.16): one file per device per UTC month of the line's HLC.
    const chatFiles = new Map<string, { dev: Dev; lines: ChatLine[]; last: number }>();
    const msgRefs = new Map<number, { deviceId: DeviceId; id: Ulid }>();
    let readHlc: string | null = null;
    const mentionToken = (k: MemberKey | 'ai' | 'everyone') => (k === 'ai' || k === 'everyone' ? k : devOf(k).memberId);
    for (const m of def.chat) {
      const dev = devOf(m.by);
      const ms = lisbon(m.at);
      const hlc = stamp(dev, ms);
      const id = ulidOf(ms, `chat|${def.key}|${m.n}`);
      const base = { format: 'tramado.chat' as const, version: 1 as const, id, hlc, ms, memberId: dev.memberId };
      const replyTo = m.replyTo !== undefined ? msgRefs.get(m.replyTo) : undefined;
      let line: ChatLine;
      if (m.kind === 'thanks' && m.thanks) {
        const lec = lectures.get(m.thanks.lecture);
        if (!lec) throw new Error(`thanks for a missing lecture ${m.thanks.lecture}`);
        line = { ...base, type: 'thanks', to: devOf(m.thanks.to).memberId, lectureId: lec.id };
      } else if (m.kind === 'ai' && m.ai) {
        line = {
          ...base, type: 'ai', ...(replyTo ? { replyTo } : {}), status: 'ok', text: m.ai.text, citations: m.ai.citations.map(citation),
          model: m.ai.model, requestedModel: m.ai.requestedModel, privacy: 'no-training',
        };
      } else {
        const text = (m.text ?? '').replace(/\{@(\w+)\}/g, (_, k: string) => `<@${mentionToken(k as MemberKey)}>`);
        const attachment = m.attachment ? docPaths.get(m.attachment) : undefined;
        const bytes = m.attachment ? await asset(def.documents.find((d) => d.key === m.attachment)!.asset) : null;
        line = {
          ...base, type: 'message', text, ...(replyTo ? { replyTo } : {}),
          ...(m.mentions?.length ? { mentions: m.mentions.map(mentionToken) } : {}),
          ...(attachment && bytes ? { attachments: [{ path: attachment.path, name: attachment.name, size: bytes.length, sha256: attachment.sha256, mime: 'application/pdf' }] } : {}),
        };
      }
      msgRefs.set(m.n, { deviceId: dev.deviceId, id });
      if (def.readUpTo !== null && m.n === def.readUpTo) readHlc = hlc;
      const month = new Date(ms).toISOString().slice(0, 7);
      const path = `.tramado/chat/${dev.deviceId}/${month}.jsonl`;
      const f = chatFiles.get(path) ?? { dev, lines: [], last: 0 };
      f.lines.push(line);
      f.last = Math.max(f.last, ms);
      chatFiles.set(path, f);
    }
    for (const [path, f] of chatFiles) put(classId, path, jsonl(f.lines), f.dev, f.last);
    if (readHlc) await platform.privateFiles.write(classId, 'chat-state.json', compact({ format: 'tramado.chat-state', version: 1, readHlc, offsets: {} }));
    // Pins (folder spec §8.18): written by readers' newer apps; 0.1 honours them without showing a pins strip.
    for (const m of def.chat.filter((x) => x.pinnedBy)) {
      const dev = devOf(m.pinnedBy!);
      const ms = lisbon(m.at) + 60_000;
      const path = `.tramado/mod/${dev.deviceId}.jsonl`;
      const line: ModLine = await signAs(dev, classId, path, {
        format: 'tramado.mod' as const, version: 1 as const, type: 'pin' as const, id: ulidOf(ms, `pin|${def.key}|${m.n}`), hlc: stamp(dev, ms), ms, memberId: dev.memberId,
        target: msgRefs.get(m.n)!,
      });
      put(classId, path, jsonl([line]), dev, ms);
    }

    // Notes (folder spec §8.21; private notes architecture §13.2) with their in-app links.
    const linkOf = (s: string) => s
      .replace(/\{lecture:(\w+)\}/g, (_, k: string) => `tramado:lecture/${lectures.get(k)?.id ?? 'missing'}`)
      .replace(/\{doc:(\w+)\}/g, (_, k: string) => `tramado:doc/${encodeURIComponent(docPaths.get(k)?.path ?? 'missing')}`);
    const privateNotes: Record<string, { mtimeMs: number }> = {};
    for (const n of def.notes) {
      const body = enc.encode(linkOf(n.body));
      const ms = lisbon(n.at);
      if (n.private) {
        const path = `notes/${n.name}`;
        await platform.privateFiles.write(classId, path, body);
        privateNotes[path] = { mtimeMs: ms };
        keys.notes[n.key] = { classKey: def.key, relPath: path, private: true };
        continue;
      }
      const path = `${dirs.notes}/${n.name}`;
      put(classId, path, body, devOf(n.by), ms);
      keys.notes[n.key] = { classKey: def.key, relPath: path, private: false };
      if (n.conflict && opts.conflict) {
        const c = n.conflict;
        const cms = lisbon(c.at);
        const stampText = new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
        const dot = n.name.lastIndexOf('.');
        const name = `${n.name.slice(0, dot)}.sync-conflict-${stampText}-${shortIdOf(devOf(c.by).deviceId)}${n.name.slice(dot)}`;
        put(classId, `${dirs.notes}/${name}`, enc.encode(c.body), devOf(c.by), cms);
      }
      if (n.editingBy) {
        // Presence (folder spec §8.4): the editor is "editing this note"; Bruno is also transcribing `l8` (UX §7.3).
        const dev = devOf(n.editingBy);
        const live = def.lectures.find((l) => l.claim?.status === 'working' && l.claim.by === n.editingBy);
        const lec = live ? lectures.get(live.key) : undefined;
        const at = opts.nowMs - MIN;
        const presence: PresenceFile = {
          format: 'tramado.presence', version: 1, deviceId: dev.deviceId, memberId: dev.memberId, seq: 214, hlc: stamp(dev, at), updatedAt: instant(at), power: 'ac',
          activity: {
            editing: { path, since: instant(opts.nowMs - 12 * MIN) },
            ...(lec && live?.claim ? { transcribing: { lectureId: lec.id, progress: live.claim.progress ?? 0, ...(live.claim.etaMs !== undefined ? { etaMs: live.claim.etaMs } : {}) } } : {}),
          },
          heartbeatS: 60,
        };
        put(classId, `.tramado/presence/${dev.deviceId}.json`, compact(presence), dev, at);
      }
    }
    if (Object.keys(privateNotes).length) await platform.privateFiles.write(classId, 'notes-index.json', compact({ format: 'tramado.notes-private', version: 1, notes: privateNotes }));

    // My private lecture data: markers, highlights, AI summaries (architecture §13.2).
    const annotations: AnnotationLine[] = [];
    for (const l of def.lectures) {
      const lec = lectures.get(l.key)!;
      if (l.markers.length) {
        const ms = lisbon(l.startedAt) + l.durationMs;
        const markers: MarkersFile = {
          format: 'tramado.markers', version: 1, lectureId: lec.id, deviceId: me, memberId: person.memberId, hlc: stamp(ana, ms),
          markers: l.markers.map((m) => {
            const atMs = clockMs(m.at);
            return { id: ulidOf(lisbon(l.startedAt) + atMs, `marker|${l.key}|${m.at}`), atMs, rawMs: atMs + 3_000, kind: m.kind, ...(m.note ? { note: m.note } : {}) };
          }),
        };
        await platform.privateFiles.write(classId, `markers/${lec.id}.json`, compact(markers));
      }
      for (const h of l.highlights ?? []) {
        const ms = lisbon(h.at);
        const seg = lec.segments.find((s) => s.id === h.segment);
        if (!seg) throw new Error(`highlight of a missing segment ${h.segment}`);
        const start = seg.text.indexOf(h.quote);
        const id = ulidOf(ms, `highlight|${l.key}|${h.segment}`);
        annotations.push({
          format: 'tramado.annotation', version: 1, type: 'add', id, annotationId: id, hlc: stamp(ana, ms), ms, memberId: person.memberId, kind: 'highlight',
          target: {
            source: { kind: 'lecture', lectureId: lec.id, audioSha256: lec.audioSha256, transcriptRevision: l.transcript?.revision ?? 1 },
            locator: { type: 'segment', segmentId: seg.id, startMs: seg.startMs, endMs: seg.endMs, charStart: start, charEnd: start + h.quote.length },
            quote: quoteOf(seg.text, h.quote),
          },
          colour: h.colour,
        });
      }
      if (l.summary) {
        const ms = lisbon(l.summary.at);
        const turn = {
          id: ulidOf(ms, `summary|${l.key}`), question: `Resumo — ${l.title}`, scope: { kinds: ['lecture' as const], lectureId: lec.id }, answer: l.summary.answer,
          citations: l.summary.citations.map(citation), model: l.summary.model, status: 'ok' as const, error: null, at: instant(ms),
          requestedModel: l.summary.model, privacy: 'no-training',
        };
        await platform.privateFiles.write(classId, `lectures/${lec.id}.json`, pretty({ format: 'tramado.lecture-private', version: 1, summary: turn, terms: null, removedAutoMarks: [] }));
      }
    }
    if (annotations.length) await platform.privateFiles.write(classId, 'annotations.jsonl', jsonl(annotations));

    // My Ask threads (private/<classId>/ask/<threadId>.jsonl).
    for (const t of def.ask) {
      const ms = lisbon(t.at);
      const threadId = ulidOf(ms, `thread|${def.key}|${t.key}`);
      const line: AskHistoryLine = {
        format: 'tramado.ask', version: 1, id: ulidOf(ms, `turn|${def.key}|${t.key}`), question: t.question,
        scope: { kinds: ['document', 'lecture', 'note'] }, answer: t.answer, citations: t.citations.map(citation), model: t.model, status: 'ok', error: null, at: instant(ms),
      };
      await platform.privateFiles.write(classId, `ask/${threadId}.jsonl`, jsonl([line]));
    }

    if (def.shared) await platform.sync.shareClass(classId, def.name);
    if (localIgnores.length) await platform.classes.update(classId, { localIgnores });
    if (def.archived) await platform.classes.update(classId, { archived: true });
  }

  prefs['ui.classOrder'] = JSON.stringify(DEMO_CLASSES.map((d) => keys.classes[d.key]));
  prefs['speech.volunteerAsked'] = '1';
  await platform.appFiles.write('prefs.json', JSON.stringify(prefs, null, 2) + '\n');
  return keys;
}
