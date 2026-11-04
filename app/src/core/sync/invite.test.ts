import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InviteV1 } from '../model/files';
import { dashless } from '../model/ids';
import {
  JOIN_PAGE, chooseInviteDevices, decodeInvite, encodeInvite, findCode, inviteJson, inviteLink, inviteWeb, qrInvite, qrText, reduceInvite,
  selectInviteAddresses,
} from './invite';

// sync spec §7.2 example (fictional)
const EXAMPLE: InviteV1 = {
  v: 1, f: 'tramado-geznkyujw4ofedwinfcmzl2rim', l: 'Teoria Geral do Direito Civil', s: 'TGDC', c: '#3e63dd', i: 'scale',
  lt: 'Prof. Menezes', tm: '2026/27 · S1', lg: 'pt-PT', m: 'k3q7mzx2v4hbtnw5r6yjc2aefg', n: 'Ana Ribeiro',
  d: [
    { id: 'AB4Z76WGA7E7XY6YXM3ZPCLW473TRYRB5Q6KTOC53UHT4S232ZWB42Q2', a: ['tcp://192.168.1.20:22117', 'relay://95.216.157.10:22067/?id=NZRTFEN-2BDQUHB-QMGXH7S-5R3WWMU-NQT3OMK-5OYCJDY-IWQHG6C-2JXUSQX', 'tcp://85.243.10.7:22117'] },
    { id: 'TKBNV236HQ5HVUDM667CHDELE5MVVW4HTSN27PQJFWFVGLDA34XDXLAT', a: ['tcp://192.168.1.31:22100', 'relay://51.15.9.21:22067/?id=X3JRS4J-RKOMMTP-AZVFRGC-YLSD4MM-TRRUSLA-GSZ3TVO-5C2EYXV-6RIHGAQ'] },
    { id: 'LGTQI2NC7CZ54ULP7HIBQVR4TCWOYY67AJFSXWTCG5QLJA5Q4X4KTTQO', a: ['tcp://10.20.0.11:22105'] },
  ],
  t: 1793721438,
};
// Valid device IDs (test-vectors/admission.json)
const D1 = '5QDNN46-YHG4AH2-3NWSGYW-RYXVGJP-JORVLZ4-3VGOMPY-S5KL2O6-AXZBAQE';
const D2 = 'Z46L5BQ-GJG7OWZ-P5LVPPJ-P3KQOBQ-JH5GPI7-2FJQ25U-CWVVI7Y-DDEGEAT';

describe('invites (sync spec §7)', () => {
  it('the §7.2 example encodes to a 1,021-character code', () => {
    const code = encodeInvite(EXAMPLE);
    expect(code.startsWith('tri1_eyJ2IjoxLCJmIjoidHJhbWFkby1nZXpua3l1anc0b2ZlZHdpbmZjbXpsMnJpbSIsImwiOiJUZW9yaWEgR2VyYWwgZG8g')).toBe(true);
    expect(code.length).toBe(1021);
    expect(inviteJson(EXAMPLE).startsWith('{"v":1,"f":"tramado-geznkyujw4ofedwinfcmzl2rim","l":')).toBe(true);
  });

  it('decodes and validates; drops devices that fail the check characters', () => {
    const good = EXAMPLE.d[1]!.id;
    const bad = good.slice(0, 13) + (good[13] === 'A' ? 'B' : 'A') + good.slice(14);   // wrong check character
    const inv: InviteV1 = { ...EXAMPLE, d: [{ id: dashless(D1), a: ['tcp://192.168.1.20:22117', 'bogus://x'] }, { id: bad, a: [] }] };
    const text = `Junta-te: ${inviteLink(encodeInvite(inv))} obrigado`;
    const d = decodeInvite(text, 1793721438);
    expect(d.invite.f).toBe(EXAMPLE.f);
    expect(d.devices.map((x) => x.deviceId)).toEqual([D1]);
    expect(d.devices[0]!.addresses).toEqual(['tcp://192.168.1.20:22117']);
    expect(d.old).toBe(false);
    expect(decodeInvite(encodeInvite({ ...inv, x: 100 }), 1793721438).old).toBe(true);
  });

  it('refuses damaged, newer and pairing codes', () => {
    expect(() => decodeInvite('hello', 0)).toThrow();
    try { decodeInvite('tri2_' + 'A'.repeat(60), 0); } catch (e) { expect(e).toBe('newer'); }
    try { decodeInvite('trp1_' + 'A'.repeat(60), 0); } catch (e) { expect(e).toBe('pair'); }
    try { decodeInvite(encodeInvite({ ...EXAMPLE, f: 'photos' }), 0); } catch (e) { expect(e).toBe('invalid'); }
    expect(() => decodeInvite(encodeInvite({ ...EXAMPLE, d: [{ id: 'B'.repeat(56), a: [] }] }), 0)).toThrow();   // no valid device
    expect(findCode('x tri1_' + 'A'.repeat(39))).toBeNull();
  });

  it('reduces codes to ≤ 2,000 characters in the order of §7.2', () => {
    const long: InviteV1 = { ...EXAMPLE, l: 'x'.repeat(120), lt: 'y'.repeat(80), tm: 'z'.repeat(40), d: EXAMPLE.d.map((d) => ({ ...d, a: [...d.a, 'quic://192.168.1.2:22000', 'tcp://8.8.8.8:22000'] })) };
    const r = reduceInvite(long, 1100);
    expect(encodeInvite(r).length).toBeLessThanOrEqual(1100);
    expect(r.d.flatMap((d) => d.a).some((a) => a.startsWith('quic://'))).toBe(false);
    expect(reduceInvite(EXAMPLE)).toEqual(EXAMPLE);
  });

  it('the QR invite has one device, ≤ 2 addresses, no s/lt/tm/lg (about 450 characters)', () => {
    const q = qrInvite(EXAMPLE);
    expect(q.d).toHaveLength(1);
    expect(q.d[0]!.a).toHaveLength(2);
    expect(q.s ?? q.lt ?? q.tm ?? q.lg).toBeUndefined();
    const text = qrText(EXAMPLE);
    expect(text).toBe(`https://feiteira.github.io/Tramado/join/#${encodeInvite(q)}`);
    expect(text.length).toBeLessThan(560);
  });

  it('the web link is the live join page with the code in the fragment (§7.2), and every form decodes', () => {
    const code = encodeInvite(EXAMPLE);
    expect(JOIN_PAGE).toBe('https://feiteira.github.io/Tramado/join/');
    const web = inviteWeb(code)!;
    expect(web).toBe(`https://feiteira.github.io/Tramado/join/#${code}`);
    const url = new URL(web);
    expect(url.origin + url.pathname + url.search).toBe(JOIN_PAGE);   // nothing of the code before the '#'
    expect(url.hash).toBe(`#${code}`);
    for (const text of [web, `Join “TGDC” on Tramado: ${web}\nOr open Tramado → Join a class and paste this code:\n${code}`, qrText(EXAMPLE)]) {
      expect(decodeInvite(text, 1793721438).invite.f).toBe(EXAMPLE.f);
    }
    expect(findCode(web)?.code).toBe(code);
  });

  it('the join page (site/join/index.html) parses codes as §7.2 does and loads nothing from anywhere', () => {
    const html = readFileSync(new URL('../../../../site/join/index.html', import.meta.url), 'utf8');
    expect(html).toContain(String.raw`/\btr([ip])(\d+)_([A-Za-z0-9_-]{40,4096})/`);   // findCode's regex
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;`);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).not.toMatch(/\s(src|srcset|action|poster)=/i);                    // no subresources, no forms
    const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]!);
    expect(hrefs.filter((h) => !h.startsWith('data:'))).toEqual(['https://github.com/feiteira/Tramado/releases']);
    expect(html).toContain("'tramado://' + (m[1] === 'p' ? 'pair/' : 'join/') + code");
  });

  it('address selection and device choice (§7.1)', () => {
    expect(selectInviteAddresses([
      'tcp://8.8.8.8:1', 'quic://192.168.1.2:3', 'tcp://192.168.1.2:1', 'tcp://10.0.0.1:1', 'tcp://172.16.0.1:1',
      'relay://1.2.3.4:22067/?id=NZRTFEN-2BDQUHB-QMGXH7S-5R3WWMU-NQT3OMK-5OYCJDY-IWQHG6C-2JXUSQX',
    ])).toEqual(['tcp://192.168.1.2:1', 'tcp://10.0.0.1:1', 'relay://1.2.3.4:22067/?id=NZRTFEN-2BDQUHB-QMGXH7S-5R3WWMU-NQT3OMK-5OYCJDY-IWQHG6C-2JXUSQX', 'tcp://8.8.8.8:1', 'quic://192.168.1.2:3']);
    const me = { deviceId: D1, addresses: [], connected: false, organiser: false, lastSeenMs: null };
    const chosen = chooseInviteDevices(me, [
      { deviceId: 'C', addresses: [], connected: false, organiser: false, lastSeenMs: 9 },
      { deviceId: 'B', addresses: [], connected: false, organiser: true, lastSeenMs: 1 },
      { deviceId: D2, addresses: [], connected: true, organiser: false, lastSeenMs: null },
    ]);
    expect(chosen.map((c) => c.deviceId)).toEqual([D1, D2, 'B']);
  });
});
