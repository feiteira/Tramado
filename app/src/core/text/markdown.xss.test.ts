// XSS corpus for the Markdown renderer (critique G27, architecture §16): classmate and model text
// must never produce markup, script URLs, event attributes or foreign images. Checked on the AST
// (what MarkdownView renders) and on renderHtml (the same rules as a string).
import { describe, expect, it } from 'vitest';
import { type Block, type Inline, parseInline, parseMarkdown, renderHtml, safeHref, safeImageSrc } from './markdown';

const PAYLOADS: string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<details open ontoggle=alert(1)>',
  '<body onload=alert(1)>',
  '<input autofocus onfocus=alert(1)>',
  '<<script>script>alert(1)<</script>/script>',
  '<scr<script>ipt>alert(1)</script>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<style>@import "javascript:alert(1)";</style>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src=javascript:alert(1)>',
  '<form action=javascript:alert(1)><button>x</button></form>',
  '<!--<img src="--><img src=x onerror=alert(1)//">',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<x onclick=alert(1)>click',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](javascript&#58;alert(1))',
  '[click](javascript&colon;alert(1))',
  '[click](&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1))',
  '[click](%6A%61%76%61%73%63%72%69%70%74:alert(1))',
  '[click](javascript://%0aalert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[click](vbscript:msgbox(1))',
  '[click](file:///etc/passwd)',
  '[click](//evil.example/x)',
  '[click](http://evil.example)',
  '[click](https://evil.example"onclick="alert(1))',
  '[click](https:alert(1))',
  '[click](https://user@evil.example)',
  '[click](https://ok.example/?q=<script>)',
  '[click](https://ok.example‮/moc.live)',
  '[click](java\u0000script:alert(1))',
  '[click](ｊａｖａｓｃｒｉｐｔ:alert(1))',
  '[click](mailto:a@b.example?subject=<script>)',
  '[click](tramado:lecture/01ABC?t=1"onclick=alert)',
  '[<img src=x onerror=alert(1)>](https://ok.example)',
  '![x](javascript:alert(1))',
  '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
  '![x](https://tracker.example/pixel.png)',
  '![x](blob:javascript:alert(1))',
  '![x" onerror="alert(1)](https://tracker.example/x.png)',
  '![<svg onload=alert(1)>](tramado-media://localhost/x.png)',
  '`<script>alert(1)</script>`',
  '```html\n<script>alert(1)</script>\n```',
  '<a id="x" onmouseover="alert(1)"></a>\n# Title',
  '<a id="x&quot; onmouseover=alert(1)"></a>\n# Title',
  '# Heading <img src=x onerror=alert(1)>',
  '| a | <script>x</script> |\n|---|---|\n| <img src=x onerror=1> | b |',
  '> <svg/onload=alert(1)>',
  '- [x](javascript:alert(1))\n- <iframe>',
  '**[x](javascript:alert(1))** *<b onmouseover=alert(1)>*',
  '[S1](javascript:alert(1)) [S2, <script>]',
  '<@ai><script>alert(1)</script> <@everyone onload=x>',
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
];

const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em', 's', 'code', 'a', 'sup', 'span',
  'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'blockquote', 'pre', 'hr']);
const ALLOWED_ATTRS: Record<string, Set<string>> = { a: new Set(['href', 'rel']), img: new Set(['src', 'alt']) };
for (let i = 1; i <= 6; i++) ALLOWED_ATTRS[`h${i}`] = new Set(['id']);

function walkInline(c: readonly Inline[], f: (n: Inline) => void) {
  for (const n of c) {
    f(n);
    if ('c' in n) walkInline(n.c, f);
  }
}
function inlinesOf(b: Block): Inline[][] {
  switch (b.t) {
    case 'heading': case 'para': case 'quote': return [b.c];
    case 'list': return b.items.map((i) => i.c);
    case 'table': return [...b.head, ...b.rows.flat()];
    default: return [];
  }
}

/** Every tag of an HTML string is allowed, with allowed attributes only and safe URLs. */
function assertSafeHtml(html: string, payload: string) {
  const ctx = `payload ${JSON.stringify(payload)} → ${html}`;
  for (const m of html.matchAll(/<\s*(\/?)([^\s>/]+)([^>]*)>/g)) {
    const tag = m[2]!.toLowerCase();
    expect(ALLOWED_TAGS.has(tag), `${ctx}: tag <${tag}>`).toBe(true);
    if (m[1]) continue;
    for (const a of m[3]!.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)) {
      const name = a[1]!.toLowerCase();
      expect(ALLOWED_ATTRS[tag]?.has(name) ?? false, `${ctx}: attribute ${name} on <${tag}>`).toBe(true);
      const value = a[2]!.replace(/&amp;/g, '&');
      if (name === 'href') expect(safeHref(value), `${ctx}: href ${value}`).not.toBeNull();
      if (name === 'src') expect(safeImageSrc(value), `${ctx}: src ${value}`).not.toBeNull();
    }
    // No unquoted attributes at all: everything the renderer writes is quoted.
    expect(m[3]!.replace(/([^\s=]+)\s*=\s*"[^"]*"/g, '').trim(), `${ctx}: stray attribute text`).toBe('');
  }
  expect(html, ctx).not.toMatch(/<\s*(script|svg|iframe|object|embed|style|math|form|input|details|body|x)\b/i);
  expect(html, ctx).not.toMatch(/\bon[a-z]+\s*=\s*"/i);
}

describe('markdown XSS corpus', () => {
  it('has at least 40 payloads', () => {
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(40);
  });

  const variants = [
    {},
    { breaks: true, citations: true, mentions: true },
  ];
  for (const opts of variants) {
    it(`never yields unsafe nodes or markup (${JSON.stringify(opts)})`, () => {
      for (const p of PAYLOADS) {
        const blocks = parseMarkdown(p, opts);
        for (const b of blocks) {
          if (b.t === 'image') expect(safeImageSrc(b.src), `image src from ${p}`).toBe(b.src);
          if (b.t === 'heading' && b.anchor) expect(b.anchor).toMatch(/^[A-Za-z0-9_-]+$/);
          for (const c of inlinesOf(b)) walkInline(c, (n) => {
            if (n.t === 'link') expect(safeHref(n.href), `link from ${p}`).toBe(n.href);
          });
        }
        assertSafeHtml(renderHtml(blocks), p);
      }
    });
  }

  it('keeps the payload text visible as text (escaped, not dropped)', () => {
    const html = renderHtml(parseMarkdown('<script>alert(1)</script>'));
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    // The link syntax ends at the first ')', so the rest of the target stays as text.
    expect(renderHtml(parseMarkdown('[click](javascript:alert(1))'))).toBe('<p>click)</p>');
    expect(renderHtml(parseMarkdown('![a pixel](https://tracker.example/p.png)'))).toBe('<p>a pixel</p>');
  });

  it('allows https, mailto and tramado links and media-scheme images', () => {
    const b = parseMarkdown('[Lei](https://dre.example/lei) [mail](mailto:ana@uni.example) [41:12](tramado:lecture/01JBX4Q7Z5W8M2E3C9R6T0YH2K?t=2472000)');
    const links: string[] = [];
    walkInline((b[0] as Extract<Block, { t: 'para' }>).c, (n) => n.t === 'link' && links.push(n.href));
    expect(links).toEqual(['https://dre.example/lei', 'mailto:ana@uni.example', 'tramado:lecture/01JBX4Q7Z5W8M2E3C9R6T0YH2K?t=2472000']);
    expect(parseMarkdown('![slide](tramado-media://localhost/c/x.png)')[0]).toEqual({ t: 'image', alt: 'slide', src: 'tramado-media://localhost/c/x.png' });
    expect(parseMarkdown('![slide](http://tramado-media.localhost/c/x.png)')[0]).toMatchObject({ t: 'image' });
    expect(safeImageSrc('blob:http://localhost:1420/7f9c2b1e-1d2a-4c55-9a0e-3b2f1d0c9e8a')).not.toBeNull();
  });

  it('reads citation markers and mention tokens only when asked', () => {
    expect(parseInline('A [S1] e [S1, S4] e [S4, n.º 3].', { citations: true })).toEqual([
      { t: 'text', v: 'A ' }, { t: 'cite', refs: ['S1'], pin: null, raw: '[S1]' }, { t: 'text', v: ' e ' },
      { t: 'cite', refs: ['S1', 'S4'], pin: null, raw: '[S1, S4]' }, { t: 'text', v: ' e ' },
      { t: 'cite', refs: ['S4'], pin: 'n.º 3', raw: '[S4, n.º 3]' }, { t: 'text', v: '.' },
    ]);
    expect(parseInline('nota [1] e [S1]')).toEqual([{ t: 'text', v: 'nota [1] e [S1]' }]);
    expect(parseInline('<@k3q7mzx2v4hbtnw5r6yjc2aefg> e <@ai>', { mentions: true })).toEqual([
      { t: 'mention', target: 'k3q7mzx2v4hbtnw5r6yjc2aefg', raw: '<@k3q7mzx2v4hbtnw5r6yjc2aefg>' }, { t: 'text', v: ' e ' },
      { t: 'mention', target: 'ai', raw: '<@ai>' },
    ]);
    expect(parseInline('<@NOTAMEMBER>', { mentions: true })).toEqual([{ t: 'text', v: '<@NOTAMEMBER>' }]);
  });
});
