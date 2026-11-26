import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  Quote,
  Sigma,
  Table as TableIcon,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  icon: React.ReactNode;
  run: (editor: Editor, helpers: { onPickImage: () => void }) => void;
}

export const NOTES_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section title',
    keywords: ['h1', 'heading', 'title'],
    icon: <Heading1 className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'heading', 'subtitle'],
    icon: <Heading2 className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Compact subsection heading',
    keywords: ['h3', 'heading', 'sub'],
    icon: <Heading3 className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bulleted List',
    description: 'Unordered list items',
    keywords: ['bullet', 'list', 'ul'],
    icon: <List className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'number',
    label: 'Numbered List',
    description: 'Ordered step list',
    keywords: ['number', 'ordered', 'ol'],
    icon: <ListOrdered className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'Checklist',
    description: 'Interactive to-do checkboxes',
    keywords: ['todo', 'task', 'check', 'checkbox'],
    icon: <CheckSquare className="h-4 w-4 text-[var(--crimson-500)]" />,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Insert a 3×3 resizable table',
    keywords: ['table', 'grid'],
    icon: <TableIcon className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'callout',
    label: 'Callout Box',
    description: 'Highlighted info callout',
    keywords: ['callout', 'note', 'box', 'alert'],
    icon: <MessageSquareQuote className="h-4 w-4 text-[var(--crimson-500)]" />,
    run: (editor) => editor.chain().focus().wrapIn('calloutBlock').run(),
  },
  {
    id: 'code',
    label: 'Code Block',
    description: 'Monospace fenced code',
    keywords: ['code', 'pre', 'snippet'],
    icon: <Code2 className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Indented blockquote',
    keywords: ['quote', 'blockquote'],
    icon: <Quote className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'math',
    label: 'Math Equation',
    description: 'LaTeX equation rendered via KaTeX',
    keywords: ['math', 'latex', 'equation', 'formula'],
    icon: <Sigma className="h-4 w-4 text-[var(--crimson-500)]" />,
    run: (editor) =>
      editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex: 'a^2 + b^2 = c^2' } }).run(),
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Upload inline image',
    keywords: ['image', 'photo', 'picture'],
    icon: <ImagePlus className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (_editor, { onPickImage }) => onPickImage(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Horizontal section rule',
    keywords: ['divider', 'hr', 'line'],
    icon: <Minus className="h-4 w-4 text-[var(--navy-900)]" />,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

interface NotesSlashMenuProps {
  open: boolean;
  query: string;
  position: { left: number; top: number };
  editor: Editor | null;
  slashRange: { from: number; to: number } | null;
  onPickImage: () => void;
  onClose: () => void;
}

export const NotesSlashMenu: React.FC<NotesSlashMenuProps> = ({
  open,
  query,
  position,
  editor,
  slashRange,
  onPickImage,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? NOTES_SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(normalized) ||
          cmd.id.includes(normalized) ||
          cmd.keywords.some((kw) => kw.includes(normalized)),
      )
    : NOTES_SLASH_COMMANDS;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  const executeItem = (cmd: SlashCommandItem) => {
    if (!editor) return;
    if (slashRange) {
      editor.chain().focus().deleteRange(slashRange).run();
    }
    cmd.run(editor, { onPickImage });
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0,
        );
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        executeItem(filtered[Math.min(selectedIndex, filtered.length - 1)]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  if (!open || filtered.length === 0) return null;

  return (
    <div
      data-testid="notes-slash-menu"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      className="folio-popover fixed z-50 w-64 max-h-72 overflow-y-auto rounded-2xl p-1.5"
    >
      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--navy-600)]">
        Insert Block
      </div>
      {filtered.map((cmd, idx) => (
        <button
          key={cmd.id}
          type="button"
          data-testid={`notes-slash-item-${cmd.id}`}
          onMouseDown={(e) => {
            e.preventDefault();
            executeItem(cmd);
          }}
          className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs ${
            idx === selectedIndex
              ? 'bg-[var(--surface-tint)] text-[var(--navy-900)]'
              : 'text-[var(--navy-900)] hover:bg-[var(--surface-tint)]/70'
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-elevated)] ring-1 ring-[var(--border-subtle)]">
            {cmd.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{cmd.label}</span>
            <span className="block truncate text-[10px] text-[var(--navy-600)]">
              {cmd.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};
