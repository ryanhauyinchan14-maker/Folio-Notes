import React, { useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  ChevronDown,
  Code,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  Palette,
  Redo2,
  Sigma,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { NotePageMargins, NotePageStyle } from '../../types/notes';
import { INTERFACE_FONT_PRESETS } from '../../utils/uiFonts';

interface NotesFormattingToolbarProps {
  editor: Editor | null;
  pageStyle: NotePageStyle;
  pageMargins: NotePageMargins;
  fontStack: string;
  onChangePageStyle: (next: NotePageStyle) => void;
  onChangePageMargins: (next: NotePageMargins) => void;
  onChangeDefaultFont: (nextFontStack: string) => void;
  onTriggerImageUpload: () => void;
}

const TEXT_COLORS = ['#072D59', '#0F172A', '#FD6E88', '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED'];
const HIGHLIGHT_COLORS = ['', '#FEF08A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FDE68A'];
const FONT_SIZES = ['12px', '14px', '15px', '16px', '18px', '20px', '24px', '30px', '36px'];

export const NotesFormattingToolbar: React.FC<NotesFormattingToolbarProps> = ({
  editor,
  pageStyle,
  pageMargins,
  fontStack,
  onChangePageStyle,
  onChangePageMargins,
  onChangeDefaultFont,
  onTriggerImageUpload,
}) => {
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);

  if (!editor) return null;

  const activeBlock = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : editor.isActive('codeBlock')
          ? 'code'
          : editor.isActive('blockquote')
            ? 'quote'
            : 'p';

  const handleBlockChange = (val: string) => {
    const chain = editor.chain().focus();
    if (val === 'h1') chain.setHeading({ level: 1 }).run();
    else if (val === 'h2') chain.setHeading({ level: 2 }).run();
    else if (val === 'h3') chain.setHeading({ level: 3 }).run();
    else if (val === 'code') chain.toggleCodeBlock().run();
    else if (val === 'quote') chain.toggleBlockquote().run();
    else chain.setParagraph().run();
  };

  const handlePromptLink = () => {
    const prev = String(editor.getAttributes('link').href ?? '');
    const next = window.prompt('Enter link URL (leave empty to remove link):', prev);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const safeHref = /^https?:\/\//i.test(trimmed) || trimmed.startsWith('mailto:')
      ? trimmed
      : `https://${trimmed}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeHref }).run();
  };

  const toggleBtnClass = (active: boolean) =>
    `folio-press inline-flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
      active
        ? 'folio-glass-active'
        : 'text-[var(--navy-900)]/80 hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
    }`;

  return (
    <div
      data-testid="notes-formatting-toolbar"
      className="sticky top-[56px] z-20 mx-auto w-full max-w-6xl px-2 pb-1.5"
    >
      <div className="folio-glass-island flex flex-wrap items-center gap-0.5 rounded-2xl px-2 py-1">
        {/* Undo / Redo */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          className={`${toggleBtnClass(false)} disabled:opacity-35`}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          className={`${toggleBtnClass(false)} disabled:opacity-35`}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>

        <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--border-subtle)]" />

        {/* Block Style */}
        <div className="relative inline-flex shrink-0 items-center">
          <select
            aria-label="Paragraph style"
            data-testid="notes-block-select"
            value={activeBlock}
            onChange={(e) => handleBlockChange(e.target.value)}
            className="folio-input h-6.5 shrink-0 cursor-pointer appearance-none whitespace-nowrap rounded-lg pl-2 pr-5 text-[11px] font-semibold"
          >
            <option value="p">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="quote">Quote</option>
            <option value="code">Code</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-[var(--navy-600)]" />
        </div>

        {/* Font Family */}
        <div className="relative hidden shrink-0 items-center sm:inline-flex">
          <select
            aria-label="Document font family"
            data-testid="notes-font-select"
            value={String(editor.getAttributes('textStyle').fontFamily || fontStack)}
            onChange={(e) => {
              const val = e.target.value;
              editor.chain().focus().setFontFamily(val).run();
              onChangeDefaultFont(val);
            }}
            className="folio-input h-6.5 max-w-[116px] shrink-0 cursor-pointer appearance-none truncate whitespace-nowrap rounded-lg pl-2 pr-5 text-[11px] font-semibold"
          >
            {INTERFACE_FONT_PRESETS.slice(0, 12).map((f) => (
              <option key={f.id} value={f.sansStack}>
                {f.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-[var(--navy-600)]" />
        </div>

        {/* Font Size */}
        <div className="relative inline-flex shrink-0 items-center">
          <select
            aria-label="Font size"
            data-testid="notes-font-size-select"
            value={String(editor.getAttributes('textStyle').fontSize || '15px')}
            onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
            className="folio-input h-6.5 shrink-0 cursor-pointer appearance-none whitespace-nowrap rounded-lg pl-1.5 pr-4 text-[11px] font-semibold"
          >
            {FONT_SIZES.map((sz) => (
              <option key={sz} value={sz}>
                {sz.replace('px', '')}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 h-3 w-3 text-[var(--navy-600)]" />
        </div>

        <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

        {/* Marks */}
        <button
          type="button"
          title="Bold (Ctrl+B)"
          aria-label="Bold"
          data-testid="notes-bold-btn"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={toggleBtnClass(editor.isActive('bold'))}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Italic (Ctrl+I)"
          aria-label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={toggleBtnClass(editor.isActive('italic'))}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Underline (Ctrl+U)"
          aria-label="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={toggleBtnClass(editor.isActive('underline'))}
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Strikethrough"
          aria-label="Strikethrough"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={toggleBtnClass(editor.isActive('strike'))}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Inline Code"
          aria-label="Inline Code"
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={toggleBtnClass(editor.isActive('code'))}
        >
          <Code className="h-3.5 w-3.5" />
        </button>

        {/* Text Color Popover */}
        <div className="relative">
          <button
            type="button"
            title="Text Color"
            aria-label="Text Color"
            onClick={() => {
              setHighlightOpen(false);
              setTextColorOpen((o) => !o);
            }}
            className={toggleBtnClass(textColorOpen)}
          >
            <Palette className="h-3.5 w-3.5" />
          </button>
          {textColorOpen && (
            <div className="folio-popover absolute left-0 top-full z-40 mt-1.5 flex gap-1.5 rounded-xl p-2">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => {
                    editor.chain().focus().setColor(c).run();
                    setTextColorOpen(false);
                  }}
                  style={{ backgroundColor: c }}
                  className="h-5 w-5 rounded-full border border-white shadow-xs"
                />
              ))}
            </div>
          )}
        </div>

        {/* Highlight Color Popover */}
        <div className="relative">
          <button
            type="button"
            title="Highlight Color"
            aria-label="Highlight Color"
            onClick={() => {
              setTextColorOpen(false);
              setHighlightOpen((o) => !o);
            }}
            className={toggleBtnClass(editor.isActive('highlight') || highlightOpen)}
          >
            <Highlighter className="h-3.5 w-3.5" />
          </button>
          {highlightOpen && (
            <div className="folio-popover absolute left-0 top-full z-40 mt-1.5 flex gap-1.5 rounded-xl p-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c || 'none'}
                  type="button"
                  aria-label={c ? `Highlight ${c}` : 'Clear Highlight'}
                  onClick={() => {
                    if (c) editor.chain().focus().setHighlight({ color: c }).run();
                    else editor.chain().focus().unsetHighlight().run();
                    setHighlightOpen(false);
                  }}
                  style={{ backgroundColor: c || '#FFFFFF' }}
                  className="h-5 w-5 rounded-full border border-[var(--border-strong)] text-[9px] font-bold"
                >
                  {!c ? '×' : ''}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

        {/* Alignment */}
        <button
          type="button"
          title="Align Left"
          aria-label="Align Left"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={toggleBtnClass(editor.isActive({ textAlign: 'left' }))}
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Align Center"
          aria-label="Align Center"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={toggleBtnClass(editor.isActive({ textAlign: 'center' }))}
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Align Right"
          aria-label="Align Right"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={toggleBtnClass(editor.isActive({ textAlign: 'right' }))}
        >
          <AlignRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Justify"
          aria-label="Justify"
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          className={toggleBtnClass(editor.isActive({ textAlign: 'justify' }))}
        >
          <AlignJustify className="h-3.5 w-3.5" />
        </button>

        <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

        {/* Lists & Checklists */}
        <button
          type="button"
          title="Bulleted List"
          aria-label="Bulleted List"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={toggleBtnClass(editor.isActive('bulletList'))}
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Numbered List"
          aria-label="Numbered List"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={toggleBtnClass(editor.isActive('orderedList'))}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Checklist"
          aria-label="Checklist"
          data-testid="notes-checklist-btn"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={toggleBtnClass(editor.isActive('taskList'))}
        >
          <CheckSquare className="h-3.5 w-3.5" />
        </button>

        <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

        {/* Insert */}
        <button
          type="button"
          title="Insert Link"
          aria-label="Insert Link"
          onClick={handlePromptLink}
          className={toggleBtnClass(editor.isActive('link'))}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Insert Image"
          aria-label="Insert Image"
          onClick={onTriggerImageUpload}
          className={toggleBtnClass(false)}
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Insert 3×3 Table"
          aria-label="Insert Table"
          data-testid="notes-insert-table-btn"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          className={toggleBtnClass(editor.isActive('table'))}
        >
          <TableIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Insert Callout Box"
          aria-label="Insert Callout Box"
          onClick={() => editor.chain().focus().wrapIn('calloutBlock').run()}
          className={toggleBtnClass(editor.isActive('calloutBlock'))}
        >
          <MessageSquareQuote className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Insert LaTeX Math Block"
          aria-label="Insert Math Block"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({ type: 'mathBlock', attrs: { latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' } })
              .run()
          }
          className={toggleBtnClass(false)}
        >
          <Sigma className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Insert Divider"
          aria-label="Insert Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={toggleBtnClass(false)}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="notes-page-style-toggle"
            onClick={() =>
              onChangePageStyle(pageStyle === 'paginated' ? 'pageless' : 'paginated')
            }
            className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/85 px-2 py-0.5 text-[11px] font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            {pageStyle === 'paginated' ? 'Pages' : 'Pageless'}
          </button>
          <div className="relative hidden shrink-0 items-center md:inline-flex">
            <select
              aria-label="Page margins"
              value={pageMargins}
              onChange={(e) => onChangePageMargins(e.target.value as NotePageMargins)}
              className="folio-input h-6.5 shrink-0 cursor-pointer appearance-none whitespace-nowrap rounded-lg pl-2 pr-5 text-[11px] font-semibold"
            >
              <option value="narrow">Narrow</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-[var(--navy-600)]" />
          </div>
        </div>
      </div>

      {/* Contextual Table Sub-Bar */}
      {editor.isActive('table') && (
        <div
          data-testid="notes-table-subbar"
          className="folio-glass-badge mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold"
        >
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowBefore().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            + Row Above
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            + Row Below
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            + Col Left
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            + Col Right
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            Del Row
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            Del Col
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-tint)]"
          >
            Header Row
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
          >
            <Trash2 className="h-3 w-3" />
            Table
          </button>
        </div>
      )}
    </div>
  );
};
