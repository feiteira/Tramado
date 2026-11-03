// HTML character references without a DOM. The named list covers Latin-1, the Latin letters
// used in Portuguese and Spanish, typography and common symbols: what real-world exports
// (Word "Save as web page", Google Docs, mail clients) actually contain. Unknown names are
// left as they are rather than guessed.

const NAMED: Record<string, number> = {
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160,
  iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169,
  ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178,
  sup3: 179, acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186, raquo: 187,
  frac14: 188, frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195,
  Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203,
  Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211,
  Ocirc: 212, Otilde: 213, Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219,
  Uuml: 220, Yacute: 221, THORN: 222, szlig: 223, agrave: 224, aacute: 225, acirc: 226, atilde: 227,
  auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233, ecirc: 234, euml: 235,
  igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241, ograve: 242, oacute: 243,
  ocirc: 244, otilde: 245, ouml: 246, divide: 247, oslash: 248, ugrave: 249, uacute: 250, ucirc: 251,
  uuml: 252, yacute: 253, thorn: 254, yuml: 255,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
  dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
  lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364, trade: 8482, larr: 8592, uarr: 8593,
  rarr: 8594, darr: 8595, harr: 8596, minus: 8722, le: 8804, ge: 8805, ne: 8800, asymp: 8776, infin: 8734,
  check: 10003, hyphen: 8208, dash: 8208, half: 189, star: 9734, starf: 9733, phone: 9742, female: 9792,
  male: 9794, hearts: 9829, Alpha: 913, Beta: 914, Gamma: 915, Delta: 916, alpha: 945, beta: 946,
  gamma: 947, delta: 948, epsilon: 949, lambda: 955, mu: 956, pi: 960, sigma: 963, omega: 969,
  Aogon: 260, aogon: 261, Cacute: 262, cacute: 263, Eogon: 280, eogon: 281, Lstrok: 321, lstrok: 322,
  Nacute: 323, nacute: 324, Sacute: 346, sacute: 347, Zacute: 377, zacute: 378, Zdot: 379, zdot: 380,
  Ccaron: 268, ccaron: 269, Zcaron: 381, zcaron: 382, Rcaron: 344, rcaron: 345, Ecaron: 282, ecaron: 283,
  NewLine: 10, Tab: 9, colon: 58, comma: 44, period: 46, excl: 33, quest: 63, num: 35, dollar: 36,
  percnt: 37, lpar: 40, rpar: 41, ast: 42, plus: 43, sol: 47, semi: 59, equals: 61, commat: 64,
  lsqb: 91, bsol: 92, rsqb: 93, lowbar: 95, grave: 96, lcub: 123, verbar: 124, rcub: 125,
};

// The legacy names browsers still accept without a semicolon ("&copy 2024", "&amp").
const LEGACY = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg', 'shy', 'deg', 'laquo', 'raquo', 'middot']);

// HTML maps numeric references in 0x80-0x9F to Windows-1252, as browsers do.
const C1 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function fromCode(n: number): string {
  if (n >= 0x80 && n <= 0x9f) n = C1[n - 0x80]!;
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\u{fffd}';
  return String.fromCodePoint(n);
}

const REF = /&(?:#[xX]([0-9a-fA-F]{1,8});?|#([0-9]{1,9});?|([A-Za-z][A-Za-z0-9]{0,31})(;?))/g;

/** Decodes character references (&eacute; &#233; &#xE9;) in HTML or XML text. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(REF, (all, hex: string | undefined, dec: string | undefined, name: string | undefined, semi: string) => {
    if (hex !== undefined) return fromCode(parseInt(hex, 16));
    if (dec !== undefined) return fromCode(parseInt(dec, 10));
    const code = NAMED[name!];
    if (code === undefined || (!semi && !LEGACY.has(name!))) return all;
    return String.fromCodePoint(code);
  });
}
