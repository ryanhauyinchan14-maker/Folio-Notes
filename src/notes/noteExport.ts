export interface NoteDocumentStats {
  words: number;
  characters: number;
  readingMinutes: number;
}

export interface NoteOutlineItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  index: number;
}

export function computeNoteStats(plainText: string): NoteDocumentStats {
  const trimmed = plainText.trim();
  const characters = plainText.replace(/\r?\n/g, '').length;
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));
  return { words, characters, readingMinutes };
}

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: JsonNode[];
}

function extractNodePlainText(node: JsonNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map(extractNodePlainText).join('');
}

export function extractNoteOutline(docJson: Record<string, unknown>): NoteOutlineItem[] {
  const root = docJson as JsonNode;
  if (!Array.isArray(root.content)) return [];
  const items: NoteOutlineItem[] = [];
  let headingIdx = 0;

  for (const child of root.content) {
    if (child.type === 'heading') {
      const rawLevel = Number(child.attrs?.level ?? 1);
      const level = (rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 1) as 1 | 2 | 3;
      const text = extractNodePlainText(child).trim() || `Untitled Heading ${headingIdx + 1}`;
      items.push({
        id: `outline-${headingIdx}`,
        level,
        text,
        index: headingIdx,
      });
      headingIdx += 1;
    }
  }
  return items;
}

function serializeInline(nodes?: JsonNode[]): string {
  if (!Array.isArray(nodes)) return '';
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n';
      let txt = typeof node.text === 'string' ? node.text : extractNodePlainText(node);
      for (const mark of node.marks ?? []) {
        if (mark.type === 'code') txt = `\`${txt}\``;
        else if (mark.type === 'bold') txt = `**${txt}**`;
        else if (mark.type === 'italic') txt = `*${txt}*`;
        else if (mark.type === 'strike') txt = `~~${txt}~~`;
        else if (mark.type === 'link' && mark.attrs?.href) {
          txt = `[${txt}](${String(mark.attrs.href)})`;
        }
      }
      return txt;
    })
    .join('');
}

function serializeList(node: JsonNode, ordered: boolean, task = false, indent = ''): string {
  const items = node.content ?? [];
  return items
    .map((item, idx) => {
      const checked = Boolean(item.attrs?.checked);
      const prefix = task
        ? `- [${checked ? 'x' : ' '}] `
        : ordered
          ? `${idx + 1}. `
          : '- ';
      const inner = (item.content ?? [])
        .map((child, cIdx) => {
          if (child.type === 'bulletList') return serializeList(child, false, false, `${indent}  `);
          if (child.type === 'orderedList') return serializeList(child, true, false, `${indent}  `);
          if (child.type === 'taskList') return serializeList(child, false, true, `${indent}  `);
          const line = serializeInline(child.content);
          return cIdx === 0 ? `${indent}${prefix}${line}` : `${indent}  ${line}`;
        })
        .join('\n');
      return inner;
    })
    .join('\n');
}

function serializeTable(node: JsonNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return '';
  const matrix = rows.map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? []).map((c) => serializeInline(c.content)).join(' ').replace(/\|/g, '\\|').trim(),
    ),
  );
  const colCount = Math.max(1, ...matrix.map((r) => r.length));
  const padded = matrix.map((r) => {
    const out = [...r];
    while (out.length < colCount) out.push('');
    return out;
  });
  const header = `| ${padded[0].join(' | ')} |`;
  const sep = `| ${padded[0].map(() => '---').join(' | ')} |`;
  const body = padded.slice(1).map((r) => `| ${r.join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function serializeBlock(node: JsonNode): string {
  switch (node.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1)));
      return `${'#'.repeat(level)} ${serializeInline(node.content)}`.trimEnd();
    }
    case 'paragraph':
      return serializeInline(node.content);
    case 'blockquote':
      return (node.content ?? [])
        .map(serializeBlock)
        .join('\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'calloutBlock':
      return (node.content ?? [])
        .map(serializeBlock)
        .join('\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '');
      return `\`\`\`${lang}\n${extractNodePlainText(node)}\n\`\`\``;
    }
    case 'bulletList':
      return serializeList(node, false, false);
    case 'orderedList':
      return serializeList(node, true, false);
    case 'taskList':
      return serializeList(node, false, true);
    case 'table':
      return serializeTable(node);
    case 'image':
      return `![${String(node.attrs?.alt ?? 'Image')}](${String(node.attrs?.src ?? '')})`;
    case 'horizontalRule':
      return '---';
    case 'mathBlock':
      return `$$\n${String(node.attrs?.latex ?? '').trim()}\n$$`;
    default:
      return (node.content ?? []).map(serializeBlock).join('\n');
  }
}

export function noteJsonToMarkdown(docJson: Record<string, unknown>): string {
  const root = docJson as JsonNode;
  if (!Array.isArray(root.content)) return '';
  return root.content
    .map(serializeBlock)
    .filter((block) => block !== undefined)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildStandaloneNoteHtml(
  title: string,
  contentHtml: string,
  fontStack = 'Inter, system-ui, sans-serif',
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title || 'Folio Note')}</title>
<style>
  body { font-family: ${fontStack}; color: #072D59; max-width: 816px; margin: 48px auto; padding: 0 32px; line-height: 1.65; }
  h1 { font-size: 2em; margin: 0.6em 0 0.35em; }
  h2 { font-size: 1.5em; margin: 0.7em 0 0.3em; }
  h3 { font-size: 1.2em; margin: 0.6em 0 0.25em; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
  th { background: #eef6fc; font-weight: 700; }
  blockquote, div[data-callout] { border-left: 4px solid #FD6E88; background: #F2F7FB; padding: 10px 14px; margin: 12px 0; border-radius: 6px; }
  pre { background: #0f2544; color: #f8fafc; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title || 'Untitled Document')}</h1>
  ${contentHtml}
</body>
</html>`;
}

export function downloadNoteFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
