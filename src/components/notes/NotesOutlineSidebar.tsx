import React from 'react';
import { ListTree } from 'lucide-react';
import type { NoteOutlineItem } from '../../notes/noteExport';

interface NotesOutlineSidebarProps {
  open: boolean;
  items: NoteOutlineItem[];
  onSelectHeading: (index: number) => void;
}

export const NotesOutlineSidebar: React.FC<NotesOutlineSidebarProps> = ({
  open,
  items,
  onSelectHeading,
}) => {
  if (!open) return null;

  return (
    <aside
      data-testid="notes-outline-sidebar"
      aria-label="Document Outline"
      className="hidden w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-glass)] backdrop-blur-md lg:flex"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3.5 py-2.5 text-xs font-bold text-[var(--navy-900)]">
        <ListTree className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
        <span>Document Outline</span>
      </div>

      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2.5">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-[var(--navy-600)]">
            Add Headings (H1–H3) via the toolbar or <code className="rounded bg-[var(--surface-seal)] px-1">/h1</code> to build a live table of contents.
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`notes-outline-item-${item.index}`}
              onClick={() => onSelectHeading(item.index)}
              style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
              className="folio-press block w-full truncate rounded-lg py-1.5 pr-2 text-left text-xs font-medium text-[var(--navy-900)]/85 hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
            >
              {item.text}
            </button>
          ))
        )}
      </div>
    </aside>
  );
};
