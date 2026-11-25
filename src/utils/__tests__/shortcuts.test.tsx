// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsModal } from '../../components/modals/KeyboardShortcutsModal';
import { NotebookEditor } from '../../components/editor/NotebookEditor';
import { COVER_PRESETS } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import { getWorkspacePreferences, saveWorkspacePreferences, sanitizeWorkspacePreferences } from '../settings';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  eventToShortcutCombo,
  formatShortcutCompact,
  formatShortcutDisplay,
  matchesShortcutEvent,
  normalizeShortcutCombo,
  sanitizeKeyboardShortcuts,
} from '../shortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Customizable Keyboard Shortcuts, Persistence, Return to Defaults & Editor Integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().resetAllKeyboardShortcuts();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    useAppStore.getState().resetAllKeyboardShortcuts();
    window.localStorage.clear();
    await useAppStore.getState().closeNotebook();
  });

  it('normalizes, converts, formats, matches, and deduplicates keyboard shortcut combos', () => {
    expect(normalizeShortcutCombo('ctrl+shift+G')).toBe('Mod+Shift+g');
    expect(normalizeShortcutCombo('Cmd+Alt+0')).toBe('Mod+Alt+0');
    expect(normalizeShortcutCombo('Mod+Shift+>')).toBe('Mod+Shift+.');
    expect(normalizeShortcutCombo('Mod++')).toBe('Mod+=');
    expect(normalizeShortcutCombo('Escape')).toBeNull();
    expect(normalizeShortcutCombo('Control')).toBeNull();

    expect(
      eventToShortcutCombo(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true })),
    ).toBeNull();
    expect(
      eventToShortcutCombo(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).toBeNull();
    expect(
      eventToShortcutCombo(new KeyboardEvent('keydown', { key: 'b' })),
    ).toBe('b');
    expect(
      eventToShortcutCombo(
        new KeyboardEvent('keydown', { key: '>', code: 'Period', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('Mod+Shift+.');
    expect(
      eventToShortcutCombo(new KeyboardEvent('keydown', { key: '?', shiftKey: true })),
    ).toBe('?');
    expect(
      eventToShortcutCombo(new KeyboardEvent('keydown', { key: 'F11', code: 'F11' })),
    ).toBe('F11');
    expect(
      eventToShortcutCombo(new KeyboardEvent('keydown', { key: ' ', code: 'Space' })),
    ).toBe('Space');

    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true }),
        'Mod+Shift+g',
      ),
    ).toBe(true);
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }),
        'Mod+Shift+=',
      ),
    ).toBe(true);
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', { key: '+', ctrlKey: true }),
        'Mod+=',
      ),
    ).toBe(true);
    expect(matchesShortcutEvent(new KeyboardEvent('keydown', { key: '?' }), '?')).toBe(true);
    expect(
      matchesShortcutEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }), '?'),
    ).toBe(true);
    expect(
      matchesShortcutEvent(new KeyboardEvent('keydown', { key: 'P', shiftKey: true }), 'p'),
    ).toBe(false);

    expect(formatShortcutDisplay('Mod+Shift+.')).toContain('Shift + >');
    expect(formatShortcutCompact('Mod+Enter')).toContain('↵');

    // Sanitizer guarantees unique combos without collisions
    const deduped = sanitizeKeyboardShortcuts({
      toolPen: 'e', // collides with toolEraser default -> swaps
      toolSelect: 'Escape', // invalid -> ignored
    });
    expect(deduped.toolPen).toBe('e');
    expect(deduped.toolEraser).toBe('p');
    expect(deduped.toolSelect).toBe('v');
  });

  it('persists custom shortcuts across workspace preferences & swaps conflicts cleanly in store', () => {
    const store = useAppStore.getState();
    const first = store.setKeyboardShortcut('toolPen', 'b');
    expect(first).toEqual({ ok: true, combo: 'b' });
    expect(useAppStore.getState().keyboardShortcuts.toolPen).toBe('b');

    // Verify localStorage persistence
    const loaded = getWorkspacePreferences();
    expect(loaded.keyboardShortcuts.toolPen).toBe('b');

    // Assigning Pen to Eraser's key ('e') automatically swaps Eraser -> 'b'
    const swapRes = useAppStore.getState().setKeyboardShortcut('toolPen', 'e');
    expect(swapRes).toEqual({
      ok: true,
      combo: 'e',
      swappedWith: 'toolEraser',
      swappedCombo: 'b',
    });
    expect(useAppStore.getState().keyboardShortcuts.toolPen).toBe('e');
    expect(useAppStore.getState().keyboardShortcuts.toolEraser).toBe('b');

    // Resetting Eraser back to 'e' while Pen owns 'e' swaps Pen cleanly to 'b'
    const resetEraserRes = useAppStore.getState().resetKeyboardShortcut('toolEraser');
    expect(resetEraserRes).toEqual({ swappedWith: 'toolPen', swappedCombo: 'b' });
    expect(useAppStore.getState().keyboardShortcuts.toolEraser).toBe(
      DEFAULT_KEYBOARD_SHORTCUTS.toolEraser,
    );
    expect(useAppStore.getState().keyboardShortcuts.toolPen).toBe('b');

    // Resetting Pen restores it to 'p' without touching Eraser
    useAppStore.getState().resetKeyboardShortcut('toolPen');
    expect(useAppStore.getState().keyboardShortcuts.toolPen).toBe('p');
    expect(useAppStore.getState().keyboardShortcuts.toolEraser).toBe('e');

    const prefs = sanitizeWorkspacePreferences(null);
    prefs.keyboardShortcuts.toggleZenMode = 'F9';
    saveWorkspacePreferences(prefs);
    expect(getWorkspacePreferences().keyboardShortcuts.toggleZenMode).toBe('F9');
  });

  it('renders customizable KeyboardShortcutsModal with capture rebind, Esc cancel, swap status, and always-visible Return to Defaults button', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onClose = vi.fn();

    await act(async () => {
      root.render(<KeyboardShortcutsModal open={true} onClose={onClose} />);
    });

    // Always-visible Return to Defaults button is present even before any customization
    const resetAllBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="shortcuts-reset-all-btn"]',
    )!;
    expect(resetAllBtn).not.toBeNull();
    expect(resetAllBtn.textContent).toContain('Return to Defaults');

    // Click Pen bind -> arms recording -> Escape cancels recording WITHOUT closing modal
    const penBindBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="shortcut-bind-toolPen"]',
    )!;
    await act(async () => {
      penBindBtn.click();
    });
    expect(penBindBtn.textContent).toBe('Press keys…');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(penBindBtn.textContent).toBe('P');

    // Record 'b' for Pen -> updates button, shows Custom badge & per-row reset
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="shortcut-bind-toolPen"]')!.click();
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    });
    expect(useAppStore.getState().keyboardShortcuts.toolPen).toBe('b');
    expect(
      container.querySelector('[data-testid="shortcut-bind-toolPen"]')?.textContent,
    ).toBe('B');
    expect(
      container.querySelector('[data-testid="shortcut-reset-toolPen"]'),
    ).not.toBeNull();
    expect(resetAllBtn.textContent).toContain('Return to Defaults (1)');

    // Record 'e' for Pen -> automatically swaps with Eraser ('b')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="shortcut-bind-toolPen"]')!.click();
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    });
    expect(useAppStore.getState().keyboardShortcuts.toolPen).toBe('e');
    expect(useAppStore.getState().keyboardShortcuts.toolEraser).toBe('b');
    expect(
      container.querySelector('[data-testid="shortcuts-status-msg"]')?.textContent,
    ).toContain('swapped');

    // Click Return to Defaults -> restores all bindings and clears custom counter
    await act(async () => {
      resetAllBtn.click();
    });
    expect(useAppStore.getState().keyboardShortcuts).toEqual(DEFAULT_KEYBOARD_SHORTCUTS);
    expect(
      container.querySelector('[data-testid="shortcut-bind-toolPen"]')?.textContent,
    ).toBe('P');
    expect(
      container.querySelector('[data-testid="shortcut-bind-toolEraser"]')?.textContent,
    ).toBe('E');
    expect(
      container.querySelector('[data-testid="shortcuts-reset-all-btn"]')?.textContent,
    ).toBe('Return to Defaults');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('applies custom shortcuts dynamically in NotebookEditor & BottomDocks and reverts cleanly on Return to Defaults', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Custom Shortcut Runtime Test',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
      useAppStore.getState().setActiveTool('pan');
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<NotebookEditor />);
    });

    // Rebind Pen tool from 'p' to 'b'
    await act(async () => {
      useAppStore.getState().setKeyboardShortcut('toolPen', 'b');
    });

    // BottomDocks badge updates to 'B'
    const penDockBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Pen"]')!;
    expect(penDockBtn.textContent).toContain('B');
    expect(penDockBtn.getAttribute('title')).toContain('(B)');

    // Pressing 'b' now activates the Pen tool
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    });
    expect(useAppStore.getState().activeTool).toBe('pen');

    // Old 'p' key is now free and spawns an airtight auto-textbox instead of hijacking tool selection
    const beforeTbCount = useAppStore.getState().pages[0].textboxes?.length ?? 0;
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(beforeTbCount + 1);
    expect(useAppStore.getState().pages[0].textboxes?.[beforeTbCount].text).toBe('p');

    // Exit active textbox editing and restore defaults
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      useAppStore.getState().setActiveTool('pan');
      useAppStore.getState().resetAllKeyboardShortcuts();
    });

    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Pen"]')?.textContent,
    ).toContain('P');

    // Default 'p' works again
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    expect(useAppStore.getState().activeTool).toBe('pen');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
