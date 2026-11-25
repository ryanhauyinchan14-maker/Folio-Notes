export type ShortcutSectionId = 'tools' | 'editing' | 'view';

export type ShortcutActionId =
  // Tools & Quick Ink
  | 'toolSelect'
  | 'toolPen'
  | 'toolHighlighter'
  | 'toolEraser'
  | 'toolLasso'
  | 'toolText'
  | 'insertImage'
  | 'inkSlot1'
  | 'inkSlot2'
  | 'inkSlot3'
  | 'inkSlot4'
  | 'inkSlot5'
  // Selection, Editing & Formatting
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'duplicate'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'deleteSelection'
  | 'cycleTextboxes'
  | 'textBold'
  | 'textItalic'
  | 'fontIncrease'
  | 'fontDecrease'
  | 'copyStyle'
  | 'pasteStyle'
  // View, Navigation & App
  | 'exportNotebook'
  | 'toggleAiSidebar'
  | 'printNotebook'
  | 'addPage'
  | 'toggleZenMode'
  | 'toggleFullscreen'
  | 'togglePagesDrawer'
  | 'canvasZoomIn'
  | 'canvasZoomOut'
  | 'canvasZoomReset'
  | 'fitView'
  | 'guiZoomIn'
  | 'guiZoomOut'
  | 'guiZoomReset'
  | 'showShortcuts';

export type KeyboardShortcutsMap = Record<ShortcutActionId, string>;

export interface ShortcutDefinition {
  id: ShortcutActionId;
  section: ShortcutSectionId;
  label: string;
  defaultCombo: string;
}

export const SHORTCUT_SECTIONS: Array<{ id: ShortcutSectionId; title: string }> = [
  { id: 'tools', title: 'Tools & Quick Ink' },
  { id: 'editing', title: 'Selection, Editing & Formatting' },
  { id: 'view', title: 'View, Navigation & App' },
];

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Tools & Quick Ink
  {
    id: 'toolSelect',
    section: 'tools',
    label: 'Universal Select tool (scribbles, text & photos)',
    defaultCombo: 'v',
  },
  { id: 'toolPen', section: 'tools', label: 'Pen tool', defaultCombo: 'p' },
  { id: 'toolHighlighter', section: 'tools', label: 'Highlighter tool', defaultCombo: 'h' },
  {
    id: 'toolEraser',
    section: 'tools',
    label: 'Eraser tool (Precision / Stroke)',
    defaultCombo: 'e',
  },
  { id: 'toolLasso', section: 'tools', label: 'Lasso select tool', defaultCombo: 'l' },
  { id: 'toolText', section: 'tools', label: 'Text tool', defaultCombo: 't' },
  { id: 'insertImage', section: 'tools', label: 'Insert image / photo', defaultCombo: 'i' },
  { id: 'inkSlot1', section: 'tools', label: 'Switch to Favorite Ink Slot 1', defaultCombo: '1' },
  { id: 'inkSlot2', section: 'tools', label: 'Switch to Favorite Ink Slot 2', defaultCombo: '2' },
  { id: 'inkSlot3', section: 'tools', label: 'Switch to Favorite Ink Slot 3', defaultCombo: '3' },
  { id: 'inkSlot4', section: 'tools', label: 'Switch to Favorite Ink Slot 4', defaultCombo: '4' },
  { id: 'inkSlot5', section: 'tools', label: 'Switch to Favorite Ink Slot 5', defaultCombo: '5' },

  // Selection, Editing & Formatting
  { id: 'undo', section: 'editing', label: 'Undo', defaultCombo: 'Mod+z' },
  { id: 'redo', section: 'editing', label: 'Redo', defaultCombo: 'Mod+y' },
  { id: 'group', section: 'editing', label: 'Group selected elements', defaultCombo: 'Mod+g' },
  {
    id: 'ungroup',
    section: 'editing',
    label: 'Ungroup selected group',
    defaultCombo: 'Mod+Shift+g',
  },
  {
    id: 'duplicate',
    section: 'editing',
    label: 'Duplicate selection (+16px offset)',
    defaultCombo: 'Mod+d',
  },
  {
    id: 'selectAll',
    section: 'editing',
    label: 'Select all strokes, textboxes & images',
    defaultCombo: 'Mod+a',
  },
  {
    id: 'copy',
    section: 'editing',
    label: 'Copy selection (or clipboard text)',
    defaultCombo: 'Mod+c',
  },
  { id: 'cut', section: 'editing', label: 'Cut selection', defaultCombo: 'Mod+x' },
  {
    id: 'paste',
    section: 'editing',
    label: 'Paste selection, clipboard text, or OS image',
    defaultCombo: 'Mod+v',
  },
  {
    id: 'deleteSelection',
    section: 'editing',
    label: 'Delete unlocked selected elements',
    defaultCombo: 'Delete',
  },
  {
    id: 'cycleTextboxes',
    section: 'editing',
    label: 'Cycle through textboxes on page',
    defaultCombo: 'Shift+Tab',
  },
  { id: 'textBold', section: 'editing', label: 'Bold selected textbox', defaultCombo: 'Mod+b' },
  {
    id: 'textItalic',
    section: 'editing',
    label: 'Italic selected textbox',
    defaultCombo: 'Mod+i',
  },
  {
    id: 'fontIncrease',
    section: 'editing',
    label: 'Increase font size (+1pt)',
    defaultCombo: 'Mod+Shift+.',
  },
  {
    id: 'fontDecrease',
    section: 'editing',
    label: 'Decrease font size (−1pt)',
    defaultCombo: 'Mod+Shift+,',
  },
  { id: 'copyStyle', section: 'editing', label: 'Copy textbox style', defaultCombo: 'Mod+Alt+c' },
  { id: 'pasteStyle', section: 'editing', label: 'Paste textbox style', defaultCombo: 'Mod+Alt+v' },

  // View, Navigation & App
  {
    id: 'exportNotebook',
    section: 'view',
    label: 'Export PDF, PNG, JPG, SVG or .folio.json',
    defaultCombo: 'Mod+e',
  },
  {
    id: 'toggleAiSidebar',
    section: 'view',
    label: 'Toggle AI Study Suite',
    defaultCombo: 'Mod+Shift+a',
  },
  { id: 'printNotebook', section: 'view', label: 'Print notebook', defaultCombo: 'Mod+p' },
  { id: 'addPage', section: 'view', label: 'Add new page', defaultCombo: 'Mod+Enter' },
  {
    id: 'toggleZenMode',
    section: 'view',
    label: 'Toggle Zen Mode (hide toolbars & chrome)',
    defaultCombo: 'Tab',
  },
  {
    id: 'toggleFullscreen',
    section: 'view',
    label: 'Toggle fullscreen window',
    defaultCombo: 'F11',
  },
  { id: 'togglePagesDrawer', section: 'view', label: 'Toggle Pages drawer', defaultCombo: 'Mod+/' },
  { id: 'canvasZoomIn', section: 'view', label: 'Zoom paper canvas in', defaultCombo: 'Mod+=' },
  { id: 'canvasZoomOut', section: 'view', label: 'Zoom paper canvas out', defaultCombo: 'Mod+-' },
  {
    id: 'canvasZoomReset',
    section: 'view',
    label: 'Reset paper zoom to 100%',
    defaultCombo: 'Mod+0',
  },
  {
    id: 'fitView',
    section: 'view',
    label: 'Fit page width / Fit whiteboard content',
    defaultCombo: 'Mod+Alt+0',
  },
  { id: 'guiZoomIn', section: 'view', label: 'Scale GUI in', defaultCombo: 'Mod+Shift+=' },
  { id: 'guiZoomOut', section: 'view', label: 'Scale GUI out', defaultCombo: 'Mod+Shift+-' },
  {
    id: 'guiZoomReset',
    section: 'view',
    label: 'Reset GUI scale to 135%',
    defaultCombo: 'Mod+Shift+0',
  },
  {
    id: 'showShortcuts',
    section: 'view',
    label: 'Show this shortcuts window',
    defaultCombo: '?',
  },
];

export const SHORTCUT_DEFINITION_MAP: Record<ShortcutActionId, ShortcutDefinition> =
  SHORTCUT_DEFINITIONS.reduce(
    (acc, def) => {
      acc[def.id] = def;
      return acc;
    },
    {} as Record<ShortcutActionId, ShortcutDefinition>,
  );

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap = SHORTCUT_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.id] = def.defaultCombo;
    return acc;
  },
  {} as KeyboardShortcutsMap,
);

export const BUILT_IN_GESTURES: Array<{ keys: string; desc: string }> = [
  {
    keys: 'Hold Right Click (Pen / Select)',
    desc: 'Temporary Lasso mode (right click selected element for menu)',
  },
  {
    keys: 'Middle Click + Drag / Space + Drag',
    desc: 'Pan canvas omnidirectionally from any tool',
  },
  {
    keys: 'Shift + Draw (Pen / Highlighter)',
    desc: 'Draw a straight horizontal or vertical line',
  },
  {
    keys: 'Any other unbound key',
    desc: 'Spawn airtight textbox & start typing',
  },
  { keys: 'Drag Empty Paper (Select)', desc: 'Marquee drag-box multi-selection' },
  { keys: 'Shift + Click', desc: 'Add or remove element from selection' },
  { keys: 'Shift + Drag', desc: 'Lock drag to horizontal or vertical axis' },
  { keys: 'Alt + Drag', desc: 'Duplicate element or group while dragging' },
  { keys: 'Ctrl / Cmd + Drag', desc: 'Bypass magnetic magenta alignment guides' },
  { keys: 'Double-click Photo', desc: 'Pan photo inside frame (Crop mode)' },
  { keys: 'Arrow Keys / Shift + Arrow', desc: 'Nudge selection by 1px / 10px' },
  { keys: 'Drag off paper edge', desc: 'Delete unlocked element or group (Undo reverts)' },
  { keys: 'Ctrl / Cmd + Scroll', desc: 'Smart zoom: GUI on Home Shelf, Canvas in Editor' },
  { keys: 'Alt + Scroll', desc: 'Zoom paper canvas' },
  { keys: 'Esc', desc: 'Exit text edit / crop mode → Deselect' },
];

const STANDALONE_MODIFIER_KEYS = new Set([
  'control',
  'meta',
  'shift',
  'alt',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'os',
  'process',
  'dead',
  'unidentified',
  'contextmenu',
]);

const SHIFTED_CHAR_TO_BASE: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '~': '`',
};

const NAMED_KEY_ALIASES: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  spacebar: 'Space',
  ' ': 'Space',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
};

const BARE_SHIFTED_SYMBOLS = new Set(['?', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '~', '<', '>', ':', '"', '{', '}', '|']);

interface ParsedShortcutCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function normalizeMainKeyToken(rawToken: string, hasShift: boolean, hasModOrAlt: boolean): string | null {
  const trimmed = rawToken.trim();
  if (!trimmed && rawToken !== ' ') return null;

  const lower = trimmed.toLowerCase();
  if (STANDALONE_MODIFIER_KEYS.has(lower) || lower === 'escape' || lower === 'esc') {
    return null;
  }

  if (NAMED_KEY_ALIASES[lower]) {
    return NAMED_KEY_ALIASES[lower];
  }
  if (rawToken === ' ') {
    return 'Space';
  }

  const fMatch = /^f([1-9]|1[0-2])$/i.exec(trimmed);
  if (fMatch) {
    return `F${fMatch[1]}`;
  }

  if (trimmed === '?' && !hasModOrAlt) {
    return '?';
  }

  if (SHIFTED_CHAR_TO_BASE[trimmed]) {
    if (!hasModOrAlt && !hasShift && BARE_SHIFTED_SYMBOLS.has(trimmed)) {
      return trimmed;
    }
    return SHIFTED_CHAR_TO_BASE[trimmed];
  }

  if (trimmed.length === 1) {
    return trimmed.toLowerCase();
  }

  return null;
}

function codeToFallbackKey(code: string): string | null {
  if (!code) return null;
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toLowerCase();
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5);
  }
  if (code === 'Equal' || code === 'NumpadAdd') return '=';
  if (code === 'Minus' || code === 'NumpadSubtract') return '-';
  if (code === 'Numpad0') return '0';
  if (/^Numpad([1-9])$/.test(code)) return code.slice(6);
  if (code === 'Period' || code === 'NumpadDecimal') return '.';
  if (code === 'Comma') return ',';
  if (code === 'Slash' || code === 'NumpadDivide') return '/';
  if (code === 'NumpadMultiply') return '*';
  if (code === 'Backslash') return '\\';
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return "'";
  if (code === 'Backquote') return '`';
  if (code === 'Space') return 'Space';
  if (code === 'Tab') return 'Tab';
  if (code === 'Enter' || code === 'NumpadEnter') return 'Enter';
  if (code === 'Delete') return 'Delete';
  if (code === 'Backspace') return 'Backspace';
  const fMatch = /^F([1-9]|1[0-2])$/.exec(code);
  if (fMatch) return code;
  return null;
}

function buildComboString(parsed: ParsedShortcutCombo): string {
  const parts: string[] = [];
  if (parsed.mod) parts.push('Mod');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(parsed.key);
  return parts.join('+');
}

export function parseShortcutCombo(raw: string): ParsedShortcutCombo | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Support literal '+' key as standalone or trailing key after '+' separator (e.g. 'Mod++')
  const rawParts: string[] = [];
  let buf = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '+') {
      if (buf.length > 0) {
        rawParts.push(buf);
        buf = '';
      } else {
        // Trailing or standalone '+' token
        rawParts.push('+');
      }
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) {
    rawParts.push(buf);
  }
  if (rawParts.length === 0) return null;

  let mod = false;
  let alt = false;
  let shift = false;
  let mainToken: string | null = null;

  for (let i = 0; i < rawParts.length; i++) {
    const token = rawParts[i].trim();
    const lower = token.toLowerCase();
    const isLast = i === rawParts.length - 1;
    if (!isLast && (lower === 'mod' || lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta')) {
      mod = true;
    } else if (!isLast && (lower === 'alt' || lower === 'option')) {
      alt = true;
    } else if (!isLast && lower === 'shift') {
      shift = true;
    } else if (isLast) {
      mainToken = token;
    } else {
      return null;
    }
  }

  if (!mainToken) return null;
  if (mainToken === '?' && !mod && !alt) {
    return { mod: false, alt: false, shift: false, key: '?' };
  }

  const normalizedKey = normalizeMainKeyToken(mainToken, shift, mod || alt);
  if (!normalizedKey) return null;

  return { mod, alt, shift, key: normalizedKey };
}

export function normalizeShortcutCombo(raw: string): string | null {
  const parsed = parseShortcutCombo(raw);
  return parsed ? buildComboString(parsed) : null;
}

/**
 * Converts a live browser `KeyboardEvent` into a canonical portable shortcut combo
 * (e.g. `'Mod+Shift+g'`, `'p'`, `'F11'`, `'?'`), or returns `null` for standalone modifiers / Escape.
 */
export function eventToShortcutCombo(e: KeyboardEvent): string | null {
  const rawKey = e.key ?? '';
  if (
    STANDALONE_MODIFIER_KEYS.has(rawKey.toLowerCase()) ||
    rawKey === 'Escape' ||
    e.code === 'Escape'
  ) {
    return null;
  }

  const mod = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  let shift = e.shiftKey;

  if (!mod && !alt && rawKey === '?') {
    return '?';
  }

  const fromKey = normalizeMainKeyToken(rawKey, shift, mod || alt);
  const fromCode = codeToFallbackKey(e.code ?? '');

  // If Alt+Letter produced a dead/non-ASCII char on some keyboard layouts, prefer physical key code
  let mainKey = fromKey ?? fromCode;
  if (mainKey && mainKey.length === 1 && mainKey.charCodeAt(0) > 127 && fromCode) {
    mainKey = fromCode;
  }
  if (!mainKey) return null;

  // Bare '+' with Shift+Equal without Mod/Alt still carries Shift semantics unless treated as shifted symbol;
  // normalize shifted punctuation with Mod/Alt cleanly (Shift preserved for multi-modifier combos)
  if (!mod && !alt && shift && rawKey in SHIFTED_CHAR_TO_BASE && BARE_SHIFTED_SYMBOLS.has(rawKey)) {
    if (rawKey === '?') return '?';
    mainKey = SHIFTED_CHAR_TO_BASE[rawKey];
  } else if (shift && mainKey in SHIFTED_CHAR_TO_BASE) {
    mainKey = SHIFTED_CHAR_TO_BASE[mainKey];
  }

  if (mainKey === '?' && !mod && !alt) {
    shift = false;
  }

  return buildComboString({ mod, alt, shift, key: mainKey });
}

/**
 * Matches a `KeyboardEvent` against a canonical shortcut combo while supporting both
 * real hardware keyboard events and synthetic test `KeyboardEvent`s.
 */
export function matchesShortcutEvent(e: KeyboardEvent, rawCombo: string): boolean {
  const parsed = parseShortcutCombo(rawCombo);
  if (!parsed) return false;

  const mod = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  const shift = e.shiftKey;

  if (!parsed.mod && !parsed.alt && !parsed.shift && BARE_SHIFTED_SYMBOLS.has(parsed.key)) {
    // Allow matching '?' both on real hardware (shiftKey: true) and synthetic events (shiftKey: false)
    if (mod || alt) return false;
    return e.key === parsed.key || (parsed.key === '?' && shift && e.code === 'Slash');
  }

  if (mod !== parsed.mod || alt !== parsed.alt || shift !== parsed.shift) {
    return false;
  }

  const rawKey = e.key ?? '';
  const lower = rawKey.toLowerCase();
  const fromCode = codeToFallbackKey(e.code ?? '');

  switch (parsed.key) {
    case '=':
      return (
        rawKey === '=' ||
        rawKey === '+' ||
        fromCode === '='
      );
    case '-':
      return (
        rawKey === '-' ||
        rawKey === '_' ||
        fromCode === '-'
      );
    case '0':
      return (
        rawKey === '0' ||
        rawKey === ')' ||
        fromCode === '0'
      );
    case '.':
      return (
        rawKey === '.' ||
        rawKey === '>' ||
        fromCode === '.'
      );
    case ',':
      return (
        rawKey === ',' ||
        rawKey === '<' ||
        fromCode === ','
      );
    case '/':
      return (
        rawKey === '/' ||
        rawKey === '?' ||
        fromCode === '/'
      );
    case 'Space':
      return rawKey === ' ' || lower === 'spacebar' || lower === 'space' || e.code === 'Space';
    case 'Enter':
      return rawKey === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
    case 'Tab':
      return rawKey === 'Tab' || e.code === 'Tab';
    case 'Delete':
      return rawKey === 'Delete' || rawKey === 'Del' || e.code === 'Delete';
    case 'Backspace':
      return rawKey === 'Backspace' || e.code === 'Backspace';
    default:
      if (/^F([1-9]|1[0-2])$/.test(parsed.key)) {
        return rawKey.toUpperCase() === parsed.key || e.code === parsed.key;
      }
      if (parsed.key.length === 1) {
        if (lower === parsed.key) return true;
        if (SHIFTED_CHAR_TO_BASE[rawKey] === parsed.key) return true;
        if (fromCode === parsed.key) return true;
        return false;
      }
      return rawKey === parsed.key || e.code === parsed.key;
  }
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

function formatKeyCapLabel(key: string, shift: boolean, compact: boolean): string {
  if (shift && key === '.') return '>';
  if (shift && key === ',') return '<';
  if (compact) {
    if (key === 'Enter') return '↵';
    if (key === 'Delete') return 'Del';
    if (key === 'Backspace') return 'Bksp';
    if (key === 'ArrowUp') return '↑';
    if (key === 'ArrowDown') return '↓';
    if (key === 'ArrowLeft') return '←';
    if (key === 'ArrowRight') return '→';
    if (key === 'Space') return 'Space';
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

export function formatShortcutDisplay(rawCombo: string): string {
  const parsed = parseShortcutCombo(rawCombo);
  if (!parsed) return rawCombo;
  const modLabel = isMacPlatform() ? 'Cmd' : 'Ctrl';
  const parts: string[] = [];
  if (parsed.mod) parts.push(modLabel);
  if (parsed.alt) parts.push(isMacPlatform() ? 'Option' : 'Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(formatKeyCapLabel(parsed.key, parsed.shift, false));
  return parts.join(' + ');
}

export function formatShortcutCompact(rawCombo: string): string {
  const parsed = parseShortcutCombo(rawCombo);
  if (!parsed) return rawCombo;
  const modLabel = isMacPlatform() ? 'Cmd' : 'Ctrl';
  const parts: string[] = [];
  if (parsed.mod) parts.push(modLabel);
  if (parsed.alt) parts.push(isMacPlatform() ? 'Opt' : 'Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(formatKeyCapLabel(parsed.key, parsed.shift, true));
  return parts.join('+');
}

export function sanitizeKeyboardShortcuts(raw: unknown): KeyboardShortcutsMap {
  const base: KeyboardShortcutsMap = { ...DEFAULT_KEYBOARD_SHORTCUTS };
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;

  // Apply valid normalized overrides one at a time, swapping any existing owner so shortcuts stay unique
  for (const def of SHORTCUT_DEFINITIONS) {
    const candidateRaw = obj[def.id];
    if (typeof candidateRaw !== 'string') continue;
    const normalized = normalizeShortcutCombo(candidateRaw);
    if (!normalized) continue;
    const prevCombo = base[def.id];
    if (normalized === prevCombo) continue;

    const owner = (Object.keys(base) as ShortcutActionId[]).find(
      (k) => k !== def.id && base[k] === normalized,
    );
    if (owner) {
      base[owner] = prevCombo;
    }
    base[def.id] = normalized;
  }

  return base;
}

export function isShortcutCustomized(
  shortcuts: KeyboardShortcutsMap,
  id: ShortcutActionId,
): boolean {
  return shortcuts[id] !== DEFAULT_KEYBOARD_SHORTCUTS[id];
}

export function countCustomizedShortcuts(shortcuts: KeyboardShortcutsMap): number {
  let count = 0;
  for (const def of SHORTCUT_DEFINITIONS) {
    if (shortcuts[def.id] !== def.defaultCombo) {
      count++;
    }
  }
  return count;
}

export function isGlobalShortcutSafeInInputs(rawCombo: string): boolean {
  const parsed = parseShortcutCombo(rawCombo);
  if (!parsed) return false;
  if (parsed.mod || parsed.alt) return true;
  return /^F([1-9]|1[0-2])$/.test(parsed.key);
}
