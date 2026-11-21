import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: 'Tools & Quick Typing',
    items: [
      { keys: 'V', desc: 'Universal Select tool (scribbles, text & photos)' },
      { keys: 'P', desc: 'Pen tool' },
      { keys: 'H', desc: 'Highlighter tool' },
      { keys: 'E', desc: 'Stroke Eraser tool' },
      { keys: 'L', desc: 'Lasso select tool' },
      { keys: 'T', desc: 'Text tool' },
      { keys: 'I', desc: 'Insert image / photo' },
      { keys: '1 – 5', desc: 'Switch to Favorite Ink Slot 1–5' },
      { keys: 'Space + Drag / Middle Click', desc: 'Pan canvas from any tool' },
      { keys: 'Any other printable key', desc: 'Spawn airtight textbox & start typing' },
    ],
  },
  {
    title: 'Selection, Grouping & Snapping',
    items: [
      { keys: 'Drag Empty Paper (V)', desc: 'Marquee drag-box multi-selection' },
      { keys: 'Shift + Click', desc: 'Add or remove element from selection' },
      { keys: 'Ctrl / Cmd + G', desc: 'Group selected elements' },
      { keys: 'Ctrl / Cmd + Shift + G', desc: 'Ungroup selected group' },
      { keys: 'Shift + Drag', desc: 'Lock drag to horizontal or vertical axis' },
      { keys: 'Alt + Drag', desc: 'Duplicate element or group while dragging' },
      { keys: 'Ctrl / Cmd + Drag', desc: 'Bypass magnetic magenta alignment guides' },
      { keys: 'Double-click Photo', desc: 'Pan photo inside frame (Crop mode)' },
      { keys: 'Arrow Keys / Shift+Arrow', desc: 'Nudge selection by 1px / 10px' },
      { keys: 'Ctrl / Cmd + D', desc: 'Duplicate selection (+16px offset)' },
      { keys: 'Ctrl / Cmd + C / X / V', desc: 'Copy / Cut / Paste (or paste OS image)' },
      { keys: 'Ctrl / Cmd + A', desc: 'Select all strokes, textboxes & images' },
      { keys: 'Shift + Tab', desc: 'Cycle through textboxes on page' },
      { keys: 'Delete / Backspace', desc: 'Delete unlocked selected elements' },
      { keys: 'Esc', desc: 'Exit text edit or crop → Deselect' },
    ],
  },
  {
    title: 'Text Formatting & View',
    items: [
      { keys: 'Ctrl / Cmd + B / I', desc: 'Bold / Italic selected textbox' },
      { keys: 'Ctrl / Cmd + Shift + > / <', desc: 'Font size ±1pt' },
      { keys: 'Ctrl / Cmd + Alt + C / V', desc: 'Copy / Paste textbox style' },
      { keys: 'Ctrl / Cmd + Z / Y', desc: 'Undo / Redo' },
      { keys: 'Ctrl / Cmd + E', desc: 'Export PDF, PNG, JPG, SVG or .folio.json' },
      { keys: 'Ctrl / Cmd + Shift + A', desc: 'Toggle Gemini AI Study Suite' },
      { keys: 'Ctrl / Cmd + P', desc: 'Print notebook' },
      { keys: 'Ctrl / Cmd + Enter', desc: 'Add new page' },
      { keys: 'Tab', desc: 'Toggle Zen Mode (hide toolbars & chrome)' },
      { keys: 'Ctrl / Cmd + /', desc: 'Toggle Pages drawer' },
      { keys: 'Ctrl / Cmd + = / -', desc: 'Zoom in / out' },
      { keys: 'Ctrl / Cmd + 0', desc: 'Reset zoom to 100%' },
      { keys: 'Ctrl / Cmd + Alt + 0', desc: 'Fit page width' },
      { keys: '?', desc: 'Show this shortcuts reference' },
    ],
  },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        data-testid="keyboard-shortcuts-modal"
        className="folio-modal-card flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-base font-bold text-[#072D59]">
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-[#072D59]/65">
                Precision shortcuts for tools, alignment, formatting &amp; navigation
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Keyboard Shortcuts"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
          {SECTIONS.map((sec) => (
            <div
              key={sec.title}
              className={sec.title === 'Selection, Grouping & Snapping' ? 'md:col-span-2' : ''}
            >
              <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[#072D59]/55">
                {sec.title}
              </h3>
              <div className="space-y-1.5 rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3">
                {sec.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="font-medium text-[#072D59]/80">{item.desc}</span>
                    <kbd className="shrink-0 rounded-md border border-[#072D59]/12 bg-white px-2 py-0.5 font-mono text-[11px] font-bold text-[#072D59] shadow-2xs">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
