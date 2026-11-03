import { describe, expect, it } from 'vitest';
import { type Block, inlineText, parseInline, parseMarkdown } from './markdown';

describe('markdown', () => {
  it('parses the constructs the manual uses', () => {
    const md = [
      '# Title', '', 'Intro **bold** and *italic* with `code` and [a link](02-x.md#y).', '',
      '<a id="first-run"></a>', '', '## Section', '', '![Alt text](../img/en/today.png)', '',
      '1. One', '2. Two', '   - nested', '', '| A | B |', '|---|---|', '| 1 | **2** |', '', '> Note',
    ].join('\n');
    const b = parseMarkdown(md);
    expect(b.map((x) => x.t)).toEqual(['heading', 'para', 'heading', 'image', 'list', 'table', 'quote']);
    expect(b[2]).toMatchObject({ t: 'heading', level: 2, anchor: 'first-run' });
    expect(b[3]).toEqual({ t: 'image', alt: 'Alt text', src: '../img/en/today.png' });
    expect(b[4]).toMatchObject({ t: 'list', ordered: true });
    expect((b[4] as { items: { depth: number }[] }).items.map((i) => i.depth)).toEqual([0, 0, 1]);
    expect(b[5]).toMatchObject({ t: 'table' });
    expect(inlineText((b[1] as Extract<Block, { t: 'para' }>).c)).toBe('Intro bold and italic with code and a link.');
  });

  it('does not treat snake_case or mid-word underscores as emphasis', () => {
    expect(parseInline('file_name_here')).toEqual([{ t: 'text', v: 'file_name_here' }]);
    expect(parseInline('a my_var_ b')).toEqual([{ t: 'text', v: 'a my_var_ b' }]);
  });

  it('reads the emphasis an assistant writes', () => {
    expect(parseInline('*she felt heard*')).toEqual([{ t: 'italic', c: [{ t: 'text', v: 'she felt heard' }] }]);
    expect(parseInline('_calmer_ now')).toEqual([{ t: 'italic', c: [{ t: 'text', v: 'calmer' }] }, { t: 'text', v: ' now' }]);
    expect(parseInline('__Plan:__ rest')).toEqual([{ t: 'bold', c: [{ t: 'text', v: 'Plan:' }] }, { t: 'text', v: ' rest' }]);
    expect(parseInline('***key***')).toEqual([{ t: 'bold', c: [{ t: 'italic', c: [{ t: 'text', v: 'key' }] }] }]);
    expect(parseInline('**Mood:** *low*, ~~anxious~~')).toEqual([
      { t: 'bold', c: [{ t: 'text', v: 'Mood:' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'low' }] },
      { t: 'text', v: ', ' },
      { t: 'strike', c: [{ t: 'text', v: 'anxious' }] },
    ]);
    expect(parseInline('**bold with *italic* inside**')).toEqual([
      { t: 'bold', c: [{ t: 'text', v: 'bold with ' }, { t: 'italic', c: [{ t: 'text', v: 'italic' }] }, { t: 'text', v: ' inside' }] },
    ]);
  });

  it('leaves lone and spaced asterisks alone', () => {
    expect(inlineText(parseInline('2 * 3 = 6 and 4 * 5'))).toBe('2 * 3 = 6 and 4 * 5');
    expect(parseInline('rated 5* overall')).toEqual([{ t: 'text', v: 'rated 5* overall' }]);
  });

  it('reads a chat reply: line breaks, bullets, code, rules', () => {
    const md = ['Two things:', 'first line', 'second line', '', '* one', '+ two', '1) three', '', '---', '', '```', 'focus: sleep', '  - diary', '```', '### Next'].join('\n');
    const b = parseMarkdown(md, { breaks: true });
    expect(b.map((x) => x.t)).toEqual(['para', 'list', 'rule', 'code', 'heading']);
    expect((b[1] as Extract<Block, { t: 'list' }>).items.map((i) => inlineText(i.c))).toEqual(['one', 'two', 'three']);
    expect(inlineText((b[0] as Extract<Block, { t: 'para' }>).c)).toBe('Two things:\nfirst line\nsecond line');
    expect(b[3]).toEqual({ t: 'code', v: 'focus: sleep\n  - diary' });
    expect(inlineText((parseMarkdown('a\nb')[0] as Extract<Block, { t: 'para' }>).c)).toBe('a b');
  });
});
