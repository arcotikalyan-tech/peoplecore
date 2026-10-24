/**
 * The formatting announcements allow, parsed into blocks the page renders as ordinary elements (never as HTML):
 * paragraphs and line breaks, "## " headings, "- " or "* " bullets, "1. " numbered items, **bold**, *italics*,
 * [links](https://…) and bare https:// addresses. Only http, https and mailto links are made.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold' | 'italic'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; children: Inline[] }
  | { kind: 'bullets' | 'numbers'; items: Inline[][] };

const TOKEN = /\*\*(.+?)\*\*|\*(?!\s)(.+?)\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', children: parseInline(m[1]) });
    else if (m[2] !== undefined) out.push({ kind: 'italic', children: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ kind: 'link', href: m[4]!, children: parseInline(m[3]) });
    else out.push({ kind: 'link', href: m[5]!, children: [{ kind: 'text', text: m[5]! }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseAnnouncement(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Extract<Block, { kind: 'bullets' | 'numbers' }> | null = null;
  const close = () => { paragraph = null; list = null; };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const number = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) { close(); continue; }
    if (heading) { close(); blocks.push({ kind: 'heading', children: parseInline(heading[1]!) }); continue; }
    const item = bullet ?? number;
    if (item) {
      const kind = bullet ? 'bullets' : 'numbers';
      if (!list || list.kind !== kind) { paragraph = null; list = { kind, items: [] }; blocks.push(list); }
      list.items.push(parseInline(item[1]!));
      continue;
    }
    list = null;
    if (!paragraph) { paragraph = []; blocks.push({ kind: 'paragraph', lines: paragraph }); }
    paragraph.push(parseInline(line.trim()));
  }
  return blocks;
}

/** The text without formatting marks, for previews such as the dashboard's announcement list. */
export function plainText(body: string): string {
  const flat = (xs: Inline[]): string => xs.map((x) => (x.kind === 'text' ? x.text : flat(x.children))).join('');
  return parseAnnouncement(body).map((b) => (b.kind === 'paragraph' ? b.lines.map(flat).join(' ') : b.kind === 'heading' ? flat(b.children) : b.items.map(flat).join('; '))).join(' ');
}
