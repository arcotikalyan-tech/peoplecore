import { describe, expect, it } from 'vitest';
import { parseAnnouncement, parseInline, plainText } from './announcement-format';

describe('announcement formatting', () => {
  it('reads bold, italics, links and bare addresses; anything else stays text', () => {
    expect(parseInline('Read **the new policy** at [the portal](https://example.test/p) or https://example.test/q.')).toEqual([
      { kind: 'text', text: 'Read ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'the new policy' }] },
      { kind: 'text', text: ' at ' },
      { kind: 'link', href: 'https://example.test/p', children: [{ kind: 'text', text: 'the portal' }] },
      { kind: 'text', text: ' or ' },
      { kind: 'link', href: 'https://example.test/q', children: [{ kind: 'text', text: 'https://example.test/q' }] },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('*Friday* only')).toEqual([{ kind: 'italic', children: [{ kind: 'text', text: 'Friday' }] }, { kind: 'text', text: ' only' }]);
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });

  it('makes no links other than http, https and mailto', () => {
    for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '<script>alert(1)</script>']) {
      expect(parseInline(bad).every((x) => x.kind === 'text'), bad).toBe(true);
    }
    expect(parseInline('[HR](mailto:hr@example.test)')[0]).toMatchObject({ kind: 'link', href: 'mailto:hr@example.test' });
  });

  it('groups lines into paragraphs, headings and lists', () => {
    const blocks = parseAnnouncement('## Office move\nWe move on **Monday**.\nPack your desk.\n\n- Laptops\n- Chargers\n1. Label boxes\n2. Leave them by the door');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'bullets', 'numbers']);
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', lines: [[{ text: 'We move on ' }, { kind: 'bold' }, { text: '.' }], [{ text: 'Pack your desk.' }]] });
    expect(blocks[2]).toMatchObject({ items: [[{ text: 'Laptops' }], [{ text: 'Chargers' }]] });
    expect(plainText('## Office move\nWe move on **Monday**.')).toBe('Office move We move on Monday.');
  });
});
