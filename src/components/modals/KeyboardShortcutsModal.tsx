import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, RotateCcw, Search, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  BUILT_IN_GESTURES,
  countCustomizedShortcuts,
  eventToShortcutCombo,
  formatShortcutDisplay,
  isShortcutCustomized,
  SHORTCUT_DEFINITION_MAP,
  SHORTCUT_DEFINITIONS,
  SHORTCUT_SECTIONS,
  type ShortcutActionId,
} from '../../utils/shortcuts';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  const keyboardShortcuts = useAppStore((s) => s.keyboardShortcuts);
  const setKeyboardShortcut = useAppStore((s) => s.setKeyboardShortcut);
  const resetKeyboardShortcut = useAppStore((s) => s.resetKeyboardShortcut);
  const resetAllKeyboardShortcuts = useAppStore((s) => s.resetAllKeyboardShortcuts);

  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRecordingId(null);
      setSearchQuery('');
      setStatusMessage(null);
    }
  }, [open]);

  // Capture-phase key recorder when a shortcut button is armed
  useEffect(() => {
    if (!open || !recordingId) return;

    const onKeyDownCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === 'Escape' || e.code === 'Escape') {
        setRecordingId(null);
        setStatusMessage('Cancelled shortcut recording.');
        return;
      }

      const combo = eventToShortcutCombo(e);
      if (!combo) {
        return;
      }

      const targetDef = SHORTCUT_DEFINITION_MAP[recordingId];
      const result = setKeyboardShortcut(recordingId, combo);
      setRecordingId(null);

      if (!result.ok) {
        setStatusMessage('Unsupported key combination — try another key.');
        return;
      }

      const display = formatShortcutDisplay(result.combo ?? combo);
      if (result.swappedWith && result.swappedCombo) {
        const swappedLabel = SHORTCUT_DEFINITION_MAP[result.swappedWith]?.label ?? result.swappedWith;
        setStatusMessage(
          `Updated "${targetDef.label}" to ${display} (swapped with "${swappedLabel}" → ${formatShortcutDisplay(result.swappedCombo)})`,
        );
      } else {
        setStatusMessage(`Updated "${targetDef.label}" to ${display}`);
      }
    };

    window.addEventListener('keydown', onKeyDownCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, { capture: true });
    };
  }, [open, recordingId, setKeyboardShortcut]);

  const customizedCount = useMemo(
    () => countCustomizedShortcuts(keyboardShortcuts),
    [keyboardShortcuts],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    return SHORTCUT_SECTIONS.map((sec) => {
      const items = SHORTCUT_DEFINITIONS.filter((def) => {
        if (def.section !== sec.id) return false;
        if (!normalizedQuery) return true;
        const currentCombo = keyboardShortcuts[def.id];
        const display = formatShortcutDisplay(currentCombo).toLowerCase();
        return (
          def.label.toLowerCase().includes(normalizedQuery) ||
          display.includes(normalizedQuery) ||
          currentCombo.toLowerCase().includes(normalizedQuery)
        );
      });
      return { ...sec, items };
    }).filter((sec) => sec.items.length > 0);
  }, [keyboardShortcuts, normalizedQuery]);

  const filteredGestures = useMemo(() => {
    if (!normalizedQuery) return BUILT_IN_GESTURES;
    return BUILT_IN_GESTURES.filter(
      (g) =>
        g.desc.toLowerCase().includes(normalizedQuery) ||
        g.keys.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery]);

  if (!open) return null;

  const handleResetOne = (id: ShortcutActionId) => {
    setRecordingId(null);
    const def = SHORTCUT_DEFINITION_MAP[id];
    const result = resetKeyboardShortcut(id);
    const defaultDisplay = formatShortcutDisplay(def.defaultCombo);
    if (result.swappedWith && result.swappedCombo) {
      const swappedLabel = SHORTCUT_DEFINITION_MAP[result.swappedWith]?.label ?? result.swappedWith;
      setStatusMessage(
        `Restored "${def.label}" to ${defaultDisplay} (swapped "${swappedLabel}" → ${formatShortcutDisplay(result.swappedCombo)})`,
      );
    } else {
      setStatusMessage(`Restored "${def.label}" to ${defaultDisplay}`);
    }
  };

  const handleReturnToDefaults = () => {
    setRecordingId(null);
    resetAllKeyboardShortcuts();
    setStatusMessage('All keyboard shortcuts restored to defaults.');
  };

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => {
        setRecordingId(null);
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        data-testid="keyboard-shortcuts-modal"
        className="folio-modal-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-base font-bold text-[var(--navy-900)]">
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                Click any shortcut key to customize it — conflicts swap automatically
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Keyboard Shortcuts"
            onClick={() => {
              setRecordingId(null);
              onClose();
            }}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search & Helper Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-tint)] px-5 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--navy-600)]" />
            <input
              type="text"
              data-testid="shortcuts-search-input"
              aria-label="Search keyboard shortcuts"
              value={searchQuery}
              onFocus={() => setRecordingId(null)}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shortcuts or keys (e.g. Pen, Ctrl+E)…"
              className="folio-input w-full rounded-xl py-1.5 pl-8 pr-3 text-xs"
            />
          </div>
          <span className="text-[11px] font-semibold text-[var(--navy-600)] tabular-nums">
            {customizedCount > 0
              ? `${customizedCount} customized · Esc cancels capture`
              : 'Using default keymap · Esc cancels capture'}
          </span>
        </div>

        {/* Scrollable Full-Width Sections (no horizontal overflow) */}
        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-5">
          {filteredSections.map((sec) => (
            <section key={sec.id} className="min-w-0">
              <h3 className="folio-section-label mb-2">
                {sec.title}
              </h3>
              <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-tint)] px-3 py-1">
                {sec.items.map((def) => {
                  const isRecording = recordingId === def.id;
                  const isCustom = isShortcutCustomized(keyboardShortcuts, def.id);
                  const displayCombo = formatShortcutDisplay(keyboardShortcuts[def.id]);

                  return (
                    <div
                      key={def.id}
                      data-testid={`shortcut-row-${def.id}`}
                      className="flex min-w-0 items-center justify-between gap-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-medium text-[var(--navy-900)]">{def.label}</span>
                        {isCustom && (
                          <span className="shrink-0 rounded-full bg-[rgba(253,110,136,0.14)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--crimson-600)]">
                            Custom
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {isCustom && (
                          <button
                            type="button"
                            data-testid={`shortcut-reset-${def.id}`}
                            title={`Reset to default (${formatShortcutDisplay(def.defaultCombo)})`}
                            aria-label={`Reset ${def.label} to default`}
                            onClick={() => handleResetOne(def.id)}
                            className="folio-press rounded-md p-1 text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--crimson-500)]"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid={`shortcut-bind-${def.id}`}
                          aria-pressed={isRecording}
                          onClick={() => {
                            setStatusMessage(null);
                            setRecordingId((cur) => (cur === def.id ? null : def.id));
                          }}
                          className={`folio-mono folio-press min-w-[68px] rounded-lg border px-2.5 py-1 text-center text-[11px] font-bold shadow-2xs ${
                            isRecording
                              ? 'border-[var(--crimson-500)] bg-[var(--crimson-500)] text-white ring-2 ring-[var(--crimson-glow)]'
                              : isCustom
                                ? 'border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:border-[var(--crimson-500)]'
                                : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-canvas)]'
                          }`}
                        >
                          {isRecording ? 'Press keys…' : displayCombo}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {filteredGestures.length > 0 && (
            <section className="min-w-0">
              <h3 className="folio-section-label mb-2">
                Mouse &amp; Built in Gestures
              </h3>
              <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3 py-1">
                {filteredGestures.map((gesture) => (
                  <div
                    key={gesture.desc}
                    className="flex min-w-0 items-center justify-between gap-4 py-2 text-xs"
                  >
                    <span className="min-w-0 font-medium text-[var(--navy-600)]">{gesture.desc}</span>
                    <kbd className="max-w-[55%] shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-0.5 text-right text-[11px] font-semibold whitespace-normal text-[var(--navy-900)] shadow-2xs">
                      {gesture.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          )}

          {filteredSections.length === 0 && filteredGestures.length === 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 text-center text-xs font-medium text-[var(--navy-600)]">
              No shortcuts matched &ldquo;{searchQuery.trim()}&rdquo;.
            </div>
          )}
        </div>

        {/* Sticky Footer with Always-Visible Return to Defaults */}
        <div className="folio-modal-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <button
            type="button"
            data-testid="shortcuts-reset-all-btn"
            onClick={handleReturnToDefaults}
            className="folio-btn-secondary folio-press inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold tabular-nums"
          >
            <RotateCcw className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
            <span>
              {customizedCount > 0
                ? `Return to Defaults (${customizedCount})`
                : 'Return to Defaults'}
            </span>
          </button>

          {statusMessage && (
            <span
              data-testid="shortcuts-status-msg"
              className="max-w-[260px] truncate text-[11px] font-semibold text-[var(--navy-600)]"
              title={statusMessage}
            >
              {statusMessage}
            </span>
          )}

          <button
            type="button"
            data-testid="shortcuts-done-btn"
            onClick={() => {
              setRecordingId(null);
              onClose();
            }}
            className="folio-btn-navy folio-press rounded-xl px-4 py-2 text-xs font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
