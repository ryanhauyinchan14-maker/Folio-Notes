export type MarkdownInlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'math'; latex: string; display: boolean }
  | { type: 'strong'; children: MarkdownInlineNode[] }
  | { type: 'em'; children: MarkdownInlineNode[] }
  | { type: 'del'; children: MarkdownInlineNode[] }
  | { type: 'link'; href: string; children: MarkdownInlineNode[] }
  | { type: 'break' };

export type MarkdownBlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInlineNode[] }
  | { type: 'paragraph'; children: MarkdownInlineNode[] }
  | { type: 'math-block'; latex: string }
  | { type: 'code-block'; language: string; code: string }
  | { type: 'hr' }
  | { type: 'blockquote'; children: MarkdownBlockNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownInlineNode[][] }
  | { type: 'table'; headers: MarkdownInlineNode[][]; rows: MarkdownInlineNode[][][] };

const ESCAPABLE_PUNCTUATION = new Set([
  '\\',
  '$',
  '*',
  '_',
  '~',
  '`',
  '[',
  ']',
  '(',
  ')',
  '#',
  '+',
  '-',
  '.',
  '!',
  '|',
  '>',
]);

function pushText(nodes: MarkdownInlineNode[], value: string): void {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last && last.type === 'text') {
    last.value += value;
  } else {
    nodes.push({ type: 'text', value });
  }
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_]/.test(ch));
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function skipProtectedSpanAt(text: string, index: number): number | null {
  const ch = text[index];
  if (ch === '`') {
    let tickLen = 1;
    while (text[index + tickLen] === '`') tickLen++;
    const fence = '`'.repeat(tickLen);
    let scan = index + tickLen;
    while (scan <= text.length - tickLen) {
      if (text.startsWith(fence, scan) && text[scan + tickLen] !== '`') {
        return scan + tickLen;
      }
      scan++;
    }
    return index + tickLen;
  }
  if (ch === '$' && !isEscapedAt(text, index)) {
    if (text[index + 1] === '$') {
      const closeIdx = findClosingDoubleDollar(text, index + 2);
      return closeIdx !== -1 ? closeIdx + 2 : null;
    }
    if (index + 1 < text.length && !/\s/.test(text[index + 1])) {
      const closeIdx = findClosingSingleDollar(text, index + 1);
      return closeIdx !== -1 ? closeIdx + 1 : null;
    }
  }
  if (ch === '\\') {
    if (text[index + 1] === '(') {
      const closeIdx = findClosingParenOrBracket(text, index + 2, '\\)');
      return closeIdx !== -1 ? closeIdx + 2 : null;
    }
    if (text[index + 1] === '[') {
      const closeIdx = findClosingParenOrBracket(text, index + 2, '\\]');
      return closeIdx !== -1 ? closeIdx + 2 : null;
    }
  }
  return null;
}

function findClosingInlineDelimiter(
  text: string,
  from: number,
  delimiter: string,
): number {
  let i = from;
  while (i <= text.length - delimiter.length) {
    if (text.startsWith(delimiter, i) && !isEscapedAt(text, i)) {
      return i;
    }
    const skippedTo = skipProtectedSpanAt(text, i);
    if (skippedTo !== null && skippedTo > i) {
      i = skippedTo;
      continue;
    }
    i++;
  }
  return -1;
}

function findClosingParenOrBracket(
  text: string,
  from: number,
  closeSeq: string,
): number {
  for (let i = from; i <= text.length - closeSeq.length; i++) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      return -1;
    }
    if (text.startsWith(closeSeq, i) && !isEscapedAt(text, i)) {
      return i;
    }
  }
  return -1;
}

function findClosingDoubleDollar(text: string, from: number): number {
  for (let i = from; i <= text.length - 2; i++) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      return -1;
    }
    if (text[i] === '$' && text[i + 1] === '$' && !isEscapedAt(text, i)) {
      return i;
    }
  }
  return -1;
}

function findClosingSingleDollar(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      return -1;
    }
    if (text[i] !== '$' || isEscapedAt(text, i)) continue;
    // Skip `$$` inside or adjacent
    if (text[i + 1] === '$') {
      i++;
      continue;
    }
    // Closing `$` cannot be preceded by whitespace (Pandoc currency guard)
    if (/\s/.test(text[i - 1] ?? '')) continue;
    // Closing `$` cannot be followed immediately by a digit (`$5 or $10`)
    if (/[0-9]/.test(text[i + 1] ?? '')) continue;
    return i;
  }
  return -1;
}

function isSafeHttpUrl(rawHref: string): boolean {
  const trimmed = rawHref.trim().toLowerCase();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

function parseLinkAt(
  text: string,
  start: number,
): { label: string; href: string; endIndex: number } | null {
  // `[label](href)`
  let i = start + 1;
  let depth = 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '[') depth++;
    else if (text[i] === ']') depth--;
    i++;
  }
  if (depth !== 0) return null;
  const label = text.slice(start + 1, i - 1);
  if (text[i] !== '(') return null;

  let j = i + 1;
  let parenDepth = 1;
  while (j < text.length && parenDepth > 0) {
    if (text[j] === '\\') {
      j += 2;
      continue;
    }
    if (text[j] === '\n') return null;
    if (text[j] === '(') parenDepth++;
    else if (text[j] === ')') parenDepth--;
    j++;
  }
  if (parenDepth !== 0) return null;
  const href = text.slice(i + 1, j - 1).trim();
  if (!label || !isSafeHttpUrl(href)) return null;
  return { label, href, endIndex: j };
}

/**
 * Parses inline Markdown and LaTeX math delimiters (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`).
 * Rejects unsafe non-HTTP(S) links and guards currency `$5 or $10` against false-positive math spans.
 */
export function parseMarkdownInline(text: string): MarkdownInlineNode[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const nodes: MarkdownInlineNode[] = [];
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    // Hard / preserved newline within paragraph
    if (ch === '\n') {
      nodes.push({ type: 'break' });
      i++;
      continue;
    }

    // LaTeX \(...\) and \[...\] MUST precede generic backslash escape handling
    if (ch === '\\') {
      const next = normalized[i + 1];
      if (next === '(') {
        const closeIdx = findClosingParenOrBracket(normalized, i + 2, '\\)');
        if (closeIdx !== -1) {
          const inner = normalized.slice(i + 2, closeIdx).trim();
          if (inner) {
            nodes.push({ type: 'math', latex: inner, display: false });
            i = closeIdx + 2;
            continue;
          }
        }
      }
      if (next === '[') {
        const closeIdx = findClosingParenOrBracket(normalized, i + 2, '\\]');
        if (closeIdx !== -1) {
          const inner = normalized.slice(i + 2, closeIdx).trim();
          if (inner) {
            nodes.push({ type: 'math', latex: inner, display: true });
            i = closeIdx + 2;
            continue;
          }
        }
      }
      if (next && ESCAPABLE_PUNCTUATION.has(next)) {
        pushText(nodes, next);
        i += 2;
        continue;
      }
      pushText(nodes, ch);
      i++;
      continue;
    }

    // Inline code span `` `...` ``
    if (ch === '`') {
      let tickLen = 1;
      while (normalized[i + tickLen] === '`') tickLen++;
      const fence = '`'.repeat(tickLen);
      let scan = i + tickLen;
      let closeIdx = -1;
      while (scan <= normalized.length - tickLen) {
        if (normalized.startsWith(fence, scan)) {
          const after = normalized[scan + tickLen];
          if (after !== '`') {
            closeIdx = scan;
            break;
          }
          while (normalized[scan] === '`') scan++;
          continue;
        }
        scan++;
      }
      if (closeIdx !== -1) {
        let codeVal = normalized.slice(i + tickLen, closeIdx);
        if (
          codeVal.length >= 2 &&
          codeVal.startsWith(' ') &&
          codeVal.endsWith(' ') &&
          /[^ ]/.test(codeVal)
        ) {
          codeVal = codeVal.slice(1, -1);
        }
        nodes.push({ type: 'code', value: codeVal });
        i = closeIdx + tickLen;
        continue;
      }
      pushText(nodes, fence);
      i += tickLen;
      continue;
    }

    // Inline $$...$$ or $...$ math
    if (ch === '$') {
      if (normalized[i + 1] === '$') {
        const closeIdx = findClosingDoubleDollar(normalized, i + 2);
        if (closeIdx !== -1) {
          const inner = normalized.slice(i + 2, closeIdx).trim();
          if (inner) {
            nodes.push({ type: 'math', latex: inner, display: true });
            i = closeIdx + 2;
            continue;
          }
        }
        pushText(nodes, '$$');
        i += 2;
        continue;
      }

      // Opening single `$` must not be followed by whitespace
      if (i + 1 < normalized.length && !/\s/.test(normalized[i + 1])) {
        const closeIdx = findClosingSingleDollar(normalized, i + 1);
        if (closeIdx !== -1) {
          const inner = normalized.slice(i + 1, closeIdx).trim();
          if (inner) {
            nodes.push({ type: 'math', latex: inner, display: false });
            i = closeIdx + 1;
            continue;
          }
        }
      }
      pushText(nodes, '$');
      i++;
      continue;
    }

    // Links `[label](https://...)`
    if (ch === '[') {
      const linkMatch = parseLinkAt(normalized, i);
      if (linkMatch) {
        nodes.push({
          type: 'link',
          href: linkMatch.href,
          children: parseMarkdownInline(linkMatch.label),
        });
        i = linkMatch.endIndex;
        continue;
      }
      pushText(nodes, '[');
      i++;
      continue;
    }

    // Strong + Em (`***...***`)
    if (normalized.startsWith('***', i) && normalized[i + 3] && !/\s/.test(normalized[i + 3])) {
      const closeIdx = findClosingInlineDelimiter(normalized, i + 3, '***');
      if (closeIdx > i + 3 && !/\s/.test(normalized[closeIdx - 1])) {
        const inner = normalized.slice(i + 3, closeIdx);
        nodes.push({
          type: 'strong',
          children: [{ type: 'em', children: parseMarkdownInline(inner) }],
        });
        i = closeIdx + 3;
        continue;
      }
    }

    // Strong (`**...**`)
    if (normalized.startsWith('**', i) && normalized[i + 2] && !/\s/.test(normalized[i + 2])) {
      const closeIdx = findClosingInlineDelimiter(normalized, i + 2, '**');
      if (closeIdx > i + 2 && !/\s/.test(normalized[closeIdx - 1])) {
        const inner = normalized.slice(i + 2, closeIdx);
        nodes.push({
          type: 'strong',
          children: parseMarkdownInline(inner),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // Strong (`__...__` with word boundary check)
    if (
      normalized.startsWith('__', i) &&
      !isWordChar(normalized[i - 1]) &&
      normalized[i + 2] &&
      !/\s/.test(normalized[i + 2])
    ) {
      const closeIdx = findClosingInlineDelimiter(normalized, i + 2, '__');
      if (
        closeIdx > i + 2 &&
        !/\s/.test(normalized[closeIdx - 1]) &&
        !isWordChar(normalized[closeIdx + 2])
      ) {
        const inner = normalized.slice(i + 2, closeIdx);
        nodes.push({
          type: 'strong',
          children: parseMarkdownInline(inner),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // Strikethrough (`~~...~~`)
    if (normalized.startsWith('~~', i) && normalized[i + 2] && !/\s/.test(normalized[i + 2])) {
      const closeIdx = findClosingInlineDelimiter(normalized, i + 2, '~~');
      if (closeIdx > i + 2 && !/\s/.test(normalized[closeIdx - 1])) {
        const inner = normalized.slice(i + 2, closeIdx);
        nodes.push({
          type: 'del',
          children: parseMarkdownInline(inner),
        });
        i = closeIdx + 2;
        continue;
      }
    }

    // Italic (`*...*`)
    if (
      ch === '*' &&
      normalized[i + 1] !== '*' &&
      normalized[i + 1] &&
      !/\s/.test(normalized[i + 1])
    ) {
      let closeIdx = -1;
      let scan = i + 1;
      while (scan < normalized.length) {
        if (
          normalized[scan] === '*' &&
          normalized[scan + 1] !== '*' &&
          normalized[scan - 1] !== '*' &&
          !isEscapedAt(normalized, scan) &&
          !/\s/.test(normalized[scan - 1])
        ) {
          closeIdx = scan;
          break;
        }
        const skippedTo = skipProtectedSpanAt(normalized, scan);
        if (skippedTo !== null && skippedTo > scan) {
          scan = skippedTo;
          continue;
        }
        scan++;
      }
      if (closeIdx > i + 1) {
        const inner = normalized.slice(i + 1, closeIdx);
        nodes.push({
          type: 'em',
          children: parseMarkdownInline(inner),
        });
        i = closeIdx + 1;
        continue;
      }
    }

    // Italic (`_..._` with word boundary check so `snake_case_var` stays literal)
    if (
      ch === '_' &&
      normalized[i + 1] !== '_' &&
      !isWordChar(normalized[i - 1]) &&
      normalized[i + 1] &&
      !/\s/.test(normalized[i + 1])
    ) {
      let closeIdx = -1;
      let scan = i + 1;
      while (scan < normalized.length) {
        if (
          normalized[scan] === '_' &&
          normalized[scan + 1] !== '_' &&
          normalized[scan - 1] !== '_' &&
          !isEscapedAt(normalized, scan) &&
          !/\s/.test(normalized[scan - 1]) &&
          !isWordChar(normalized[scan + 1])
        ) {
          closeIdx = scan;
          break;
        }
        const skippedTo = skipProtectedSpanAt(normalized, scan);
        if (skippedTo !== null && skippedTo > scan) {
          scan = skippedTo;
          continue;
        }
        scan++;
      }
      if (closeIdx > i + 1) {
        const inner = normalized.slice(i + 1, closeIdx);
        nodes.push({
          type: 'em',
          children: parseMarkdownInline(inner),
        });
        i = closeIdx + 1;
        continue;
      }
    }

    pushText(nodes, ch);
    i++;
  }

  return nodes;
}

const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})([^\n]*)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}(?:\*{3,}|-{3,}|_{3,})\s*$/;
const BLOCKQUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const UL_ITEM_RE = /^\s{0,3}([*+-])\s+(.*)$/;
const OL_ITEM_RE = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?::?-{3,}:?\s*)?\|?\s*$/;

function splitTableCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (trimmed[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

function tryMatchDisplayMathBlock(
  lines: string[],
  startLine: number,
): { latex: string; nextLine: number } | null {
  const firstTrimmed = lines[startLine].trim();

  if (firstTrimmed.startsWith('$$')) {
    // Single-line `$$...$$`
    if (firstTrimmed.length > 4 && firstTrimmed.endsWith('$$')) {
      const inner = firstTrimmed.slice(2, -2).trim();
      if (inner) {
        return { latex: inner, nextLine: startLine + 1 };
      }
    }
    // Multi-line `$$...` ... `...$$`
    const firstRest = firstTrimmed.slice(2);
    const bodyLines: string[] = firstRest.trim() ? [firstRest] : [];
    for (let j = startLine + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.endsWith('$$') && !isEscapedAt(t, t.length - 2)) {
        const beforeClose = t.slice(0, -2).trimEnd();
        if (beforeClose) bodyLines.push(beforeClose);
        const latex = bodyLines.join('\n').trim();
        if (!latex) return null;
        return { latex, nextLine: j + 1 };
      }
      bodyLines.push(lines[j]);
    }
    return null;
  }

  if (firstTrimmed.startsWith('\\[')) {
    if (firstTrimmed.length > 4 && firstTrimmed.endsWith('\\]')) {
      const inner = firstTrimmed.slice(2, -2).trim();
      if (inner) {
        return { latex: inner, nextLine: startLine + 1 };
      }
    }
    const firstRest = firstTrimmed.slice(2);
    const bodyLines: string[] = firstRest.trim() ? [firstRest] : [];
    for (let j = startLine + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.endsWith('\\]')) {
        const beforeClose = t.slice(0, -2).trimEnd();
        if (beforeClose) bodyLines.push(beforeClose);
        const latex = bodyLines.join('\n').trim();
        if (!latex) return null;
        return { latex, nextLine: j + 1 };
      }
      bodyLines.push(lines[j]);
    }
    return null;
  }

  return null;
}

function isTableStart(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) return false;
  const header = lines[idx];
  const sep = lines[idx + 1];
  return header.includes('|') && TABLE_SEP_RE.test(sep);
}

function isBlockBoundaryAt(lines: string[], idx: number): boolean {
  const line = lines[idx];
  if (!line.trim()) return true;
  if (FENCE_OPEN_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (BLOCKQUOTE_RE.test(line)) return true;
  if (UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) return true;
  if (isTableStart(lines, idx)) return true;
  if (tryMatchDisplayMathBlock(lines, idx) !== null) return true;
  return false;
}

/**
 * Parses block-level Markdown (headings, paragraphs, lists, quotes, tables, fenced code, hr)
 * alongside display LaTeX (`$$...$$` / `\[...\]`).
 */
export function parseMarkdownBlocks(input: string): MarkdownBlockNode[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // 1. Fenced code blocks
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      const fenceChars = fenceMatch[1];
      const fenceChar = fenceChars[0];
      const fenceLen = fenceChars.length;
      const language = fenceMatch[2].trim().split(/\s+/)[0] || '';
      const codeLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const trimmed = lines[j].trim();
        if (
          trimmed.startsWith(fenceChar.repeat(fenceLen)) &&
          new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`).test(trimmed)
        ) {
          j++;
          break;
        }
        codeLines.push(lines[j]);
        j++;
      }
      blocks.push({
        type: 'code-block',
        language,
        code: codeLines.join('\n'),
      });
      i = j;
      continue;
    }

    // 2. Display math blocks ($$...$$ or \[...\])
    const mathBlock = tryMatchDisplayMathBlock(lines, i);
    if (mathBlock) {
      blocks.push({ type: 'math-block', latex: mathBlock.latex });
      i = mathBlock.nextLine;
      continue;
    }

    // 3. Horizontal rule (must precede unordered list check for `- - -`)
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 4. Headings (# .. ######)
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = Math.min(6, Math.max(1, headingMatch[1].length)) as
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6;
      blocks.push({
        type: 'heading',
        level,
        children: parseMarkdownInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // 5. Blockquotes
    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length) {
        const m = BLOCKQUOTE_RE.exec(lines[j]);
        if (!m) break;
        quoteLines.push(m[1]);
        j++;
      }
      blocks.push({
        type: 'blockquote',
        children: parseMarkdownBlocks(quoteLines.join('\n')),
      });
      i = j;
      continue;
    }

    // 6. GFM Pipe Table
    if (isTableStart(lines, i)) {
      const headerCells = splitTableCells(lines[i]).map(parseMarkdownInline);
      const rows: MarkdownInlineNode[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
        rows.push(splitTableCells(lines[j]).map(parseMarkdownInline));
        j++;
      }
      blocks.push({
        type: 'table',
        headers: headerCells,
        rows,
      });
      i = j;
      continue;
    }

    // 7. Unordered / Ordered Lists (joins wrapped continuation lines cleanly)
    const ulFirst = UL_ITEM_RE.exec(line);
    const olFirst = !ulFirst ? OL_ITEM_RE.exec(line) : null;
    if (ulFirst || olFirst) {
      const ordered = Boolean(olFirst);
      const start = olFirst ? Math.max(1, Number.parseInt(olFirst[1], 10) || 1) : 1;
      const itemsText: string[] = [
        (ulFirst ? ulFirst[2] : olFirst![2]).trimEnd(),
      ];
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j];
        if (!nextLine.trim()) {
          // Allow single blank line between items of the same list kind
          let k = j + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (
            k < lines.length &&
            ((ordered && OL_ITEM_RE.test(lines[k])) || (!ordered && UL_ITEM_RE.test(lines[k])))
          ) {
            j = k;
            continue;
          }
          break;
        }

        const ulNext = UL_ITEM_RE.exec(nextLine);
        const olNext = !ulNext ? OL_ITEM_RE.exec(nextLine) : null;

        if (ulNext) {
          if (ordered) break;
          itemsText.push(ulNext[2].trimEnd());
          j++;
          continue;
        }
        if (olNext) {
          if (!ordered) break;
          itemsText.push(olNext[2].trimEnd());
          j++;
          continue;
        }

        // Stop if another block starts on this line
        if (isBlockBoundaryAt(lines, j)) {
          break;
        }

        // Hard-wrapped continuation line inside current list item
        itemsText[itemsText.length - 1] += ' ' + nextLine.trim();
        j++;
      }

      blocks.push({
        type: 'list',
        ordered,
        start,
        items: itemsText.map((itemText) => parseMarkdownInline(itemText)),
      });
      i = j;
      continue;
    }

    // 8. Paragraph: stops immediately before any block boundary
    const paraLines: string[] = [lines[i]];
    let j = i + 1;
    while (j < lines.length && !isBlockBoundaryAt(lines, j)) {
      paraLines.push(lines[j]);
      j++;
    }
    blocks.push({
      type: 'paragraph',
      children: parseMarkdownInline(paraLines.join('\n')),
    });
    i = j;
  }

  return blocks;
}

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  approx: '≈',
  neq: '≠',
  ne: '≠',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  equiv: '≡',
  cong: '≅',
  sim: '∼',
  propto: '∝',
  pm: '±',
  mp: '∓',
  times: '×',
  cdot: '·',
  div: '÷',
  ast: '∗',
  star: '⋆',
  circ: '∘',
  bullet: '•',
  in: '∈',
  notin: '∉',
  ni: '∋',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  supseteq: '⊇',
  cup: '∪',
  bigcup: '⋃',
  cap: '∩',
  bigcap: '⋂',
  emptyset: '∅',
  varnothing: '∅',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  neg: '¬',
  land: '∧',
  lor: '∨',
  implies: '⇒',
  iff: '⇔',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  mapsto: '↦',
  partial: '∂',
  nabla: '∇',
  infty: '∞',
  sum: '∑',
  prod: '∏',
  int: '∫',
  iint: '∬',
  oint: '∮',
  angle: '∠',
  degree: '°',
  perp: '⊥',
  parallel: '∥',
  triangle: '△',
  therefore: '∴',
  because: '∵',
  dots: '…',
  ldots: '…',
  cdots: '⋯',
  vdots: '⋮',
  langle: '⟨',
  rangle: '⟩',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  quad: ' ',
  qquad: '  ',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  csc: 'csc',
  sec: 'sec',
  cot: 'cot',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  ln: 'ln',
  log: 'log',
  exp: 'exp',
  lim: 'lim',
  max: 'max',
  min: 'min',
  sup: 'sup',
  inf: 'inf',
  det: 'det',
  dim: 'dim',
  deg: 'deg',
  gcd: 'gcd',
  bmod: 'mod',
  pmod: 'mod',
  left: '',
  right: '',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};

function readArg(src: string, start: number): { value: string; next: number } | null {
  let i = start;
  while (i < src.length && src[i] === ' ') i++;
  if (i >= src.length) return null;

  if (src[i] === '{') {
    let depth = 1;
    let j = i + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '\\' && j + 1 < src.length) {
        j += 2;
        continue;
      }
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    if (depth === 0) {
      return { value: src.slice(i + 1, j - 1), next: j };
    }
    return { value: src.slice(i + 1), next: src.length };
  }

  return { value: src[i], next: i + 1 };
}

function toUnicodeScript(text: string, table: Record<string, string>): string | null {
  if (!text) return null;
  let out = '';
  for (const ch of text) {
    if (ch === ' ') continue;
    const mapped = table[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out || null;
}

const TEXT_WRAPPER_COMMANDS = new Set([
  'text',
  'textrm',
  'textbf',
  'textit',
  'mathrm',
  'mathbf',
  'mathit',
  'mathbb',
  'mathcal',
  'operatorname',
  'boldsymbol',
  'hat',
  'bar',
  'vec',
  'tilde',
  'underline',
]);

/**
 * Converts a LaTeX math expression into clean, readable plain Unicode text
 * for Folio Notes Canvas2D textboxes.
 */
export function latexToReadableUnicode(expr: string): string {
  const src = expr.replace(/\r\n?/g, ' ').replace(/\n+/g, ' ').trim();
  if (!src) return '';

  let out = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const next = src[i + 1];
      if (!next) {
        i++;
        continue;
      }
      if (next === ',' || next === ';' || next === ':' || next === ' ') {
        out += ' ';
        i += 2;
        continue;
      }
      if (next === '!') {
        i += 2;
        continue;
      }
      if (next === '\\') {
        out += '\n';
        i += 2;
        continue;
      }
      if (!/[A-Za-z]/.test(next)) {
        out += next;
        i += 2;
        continue;
      }

      let cmdEnd = i + 1;
      while (cmdEnd < src.length && /[A-Za-z]/.test(src[cmdEnd])) {
        cmdEnd++;
      }
      const cmd = src.slice(i + 1, cmdEnd);

      if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
        const numArg = readArg(src, cmdEnd);
        const denArg = numArg ? readArg(src, numArg.next) : null;
        if (numArg && denArg) {
          const num = latexToReadableUnicode(numArg.value);
          const den = latexToReadableUnicode(denArg.value);
          const simpleNum = /^[A-Za-z0-9α-ωΑ-Ω₀-₉⁰-⁹]+$/.test(num);
          const simpleDen = /^[A-Za-z0-9α-ωΑ-Ω₀-₉⁰-⁹]+$/.test(den);
          out += `${simpleNum ? num : `(${num})`}/${simpleDen ? den : `(${den})`}`;
          i = denArg.next;
          continue;
        }
      }

      if (cmd === 'sqrt') {
        let scan = cmdEnd;
        let rootIndex = '';
        while (scan < src.length && src[scan] === ' ') scan++;
        if (src[scan] === '[') {
          const closeBracket = src.indexOf(']', scan + 1);
          if (closeBracket !== -1) {
            rootIndex = latexToReadableUnicode(src.slice(scan + 1, closeBracket));
            scan = closeBracket + 1;
          }
        }
        const radArg = readArg(src, scan);
        if (radArg) {
          const inner = latexToReadableUnicode(radArg.value);
          const prefix =
            rootIndex === '3'
              ? '∛'
              : rootIndex
                ? `${toUnicodeScript(rootIndex, SUPERSCRIPT_MAP) ?? rootIndex}√`
                : '√';
          const simple = /^[A-Za-z0-9α-ωΑ-Ω₀-₉]+$/.test(inner);
          out += `${prefix}${simple ? inner : `(${inner})`}`;
          i = radArg.next;
          continue;
        }
      }

      if (cmd === 'overline') {
        const arg = readArg(src, cmdEnd);
        if (arg) {
          const inner = latexToReadableUnicode(arg.value);
          out += inner.length === 1 ? `${inner}\u0304` : inner;
          i = arg.next;
          continue;
        }
      }

      if (TEXT_WRAPPER_COMMANDS.has(cmd)) {
        const arg = readArg(src, cmdEnd);
        if (arg) {
          out +=
            cmd.startsWith('text') || cmd === 'mathrm' || cmd === 'operatorname'
              ? arg.value
              : latexToReadableUnicode(arg.value);
          i = arg.next;
          continue;
        }
      }

      if (cmd in LATEX_SYMBOLS) {
        const sym = LATEX_SYMBOLS[cmd];
        const prevChar = out[out.length - 1];
        const nextChar = src[cmdEnd];
        if (sym && /^[A-Za-z]+$/.test(sym) && prevChar && /[A-Za-z0-9₀-₉)]$/.test(prevChar)) {
          out += ' ';
        }
        out += sym;
        if (
          sym &&
          /^[A-Za-z]+$/.test(sym) &&
          nextChar &&
          /[A-Za-z0-9]/.test(nextChar)
        ) {
          out += ' ';
        }
        i = cmdEnd;
        continue;
      }

      out += cmd;
      i = cmdEnd;
      continue;
    }

    if (ch === '_' || ch === '^') {
      const table = ch === '_' ? SUBSCRIPT_MAP : SUPERSCRIPT_MAP;
      const arg = readArg(src, i + 1);
      if (arg) {
        const inner = latexToReadableUnicode(arg.value);
        const mapped = toUnicodeScript(inner, table);
        if (mapped) {
          out += mapped;
        } else {
          out += `${ch}${inner.length > 1 ? `(${inner})` : inner}`;
        }
        i = arg.next;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '{' || ch === '}') {
      i++;
      continue;
    }

    if (ch === '~') {
      out += ' ';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

function serializeInlineToPlainText(nodes: MarkdownInlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'math':
          return latexToReadableUnicode(node.latex);
        case 'strong':
        case 'em':
        case 'del':
        case 'link':
          return serializeInlineToPlainText(node.children);
        case 'break':
          return '\n';
      }
    })
    .join('');
}

function serializeBlocksToPlainText(blocks: MarkdownBlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return serializeInlineToPlainText(block.children);
        case 'paragraph':
          return serializeInlineToPlainText(block.children);
        case 'math-block':
          return latexToReadableUnicode(block.latex);
        case 'code-block':
          return block.code;
        case 'hr':
          return '────────';
        case 'blockquote':
          return serializeBlocksToPlainText(block.children)
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
        case 'list':
          return block.items
            .map((item, idx) => {
              const prefix = block.ordered ? `${block.start + idx}. ` : '• ';
              return `${prefix}${serializeInlineToPlainText(item)}`;
            })
            .join('\n');
        case 'table': {
          const headLine = block.headers
            .map((cell) => serializeInlineToPlainText(cell))
            .join(' | ');
          const rowLines = block.rows.map((row) =>
            row.map((cell) => serializeInlineToPlainText(cell)).join(' | '),
          );
          return [headLine, ...rowLines].join('\n');
        }
      }
    })
    .join('\n\n');
}

/**
 * Converts Markdown + LaTeX AI output into clean plain Unicode text
 * ready for Canvas2D Textbox insertion while keeping plain strings unchanged.
 */
export function formatAiMarkdownForTextbox(raw: string): string {
  if (!raw) return '';
  const blocks = parseMarkdownBlocks(raw);
  if (blocks.length === 0) return raw.trim();
  return serializeBlocksToPlainText(blocks).trim();
}
