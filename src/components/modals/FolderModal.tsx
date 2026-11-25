import React, { useEffect, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { FOLDER_COLORS } from '../../constants/covers';
import { useAppStore } from '../../store/useAppStore';
import type { Folder } from '../../types/notes';

interface FolderModalProps {
  open: boolean;
  editingFolder?: Folder | null;
  onClose: () => void;
}

export const FolderModal: React.FC<FolderModalProps> = ({
  open,
  editingFolder,
  onClose,
}) => {
  const createFolder = useAppStore((s) => s.createFolder);
  const renameFolder = useAppStore((s) => s.renameFolder);

  const [name, setName] = useState('');
  const [color, setColor] = useState(FOLDER_COLORS[0]);

  useEffect(() => {
    if (!open) return;
    if (editingFolder) {
      setName(editingFolder.name);
      setColor(editingFolder.color);
    } else {
      setName('');
      setColor(FOLDER_COLORS[0]);
    }
  }, [open, editingFolder]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || 'Untitled Folder';
    if (editingFolder) {
      await renameFolder(editingFolder.id, finalName, color);
    } else {
      await createFolder(finalName, color);
    }
    onClose();
  };

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-modal-title"
        className="folio-modal-card w-full max-w-sm overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
              <FolderPlus className="h-4 w-4" />
            </div>
            <h2 id="folder-modal-title" className="text-base font-bold text-[var(--navy-900)]">
              {editingFolder ? 'Edit Folder' : 'New Folder'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close folder modal"
            onClick={onClose}
            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label
              htmlFor="folder-name-input"
              className="folio-section-label mb-1.5 block"
            >
              Folder Name
            </label>
            <input
              id="folder-name-input"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Fall Semester"
              className="folio-input w-full rounded-xl px-3.5 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="folio-section-label mb-2 block">
              Folder Color
            </label>
            <div className="flex items-center gap-2.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Folder color ${c}`}
                  onClick={() => setColor(c)}
                  className={`folio-press h-7 w-7 rounded-full ${
                    color === c
                      ? 'scale-110 ring-2 ring-[var(--navy-900)] ring-offset-2'
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="folio-btn-secondary folio-press rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="folio-btn-crimson folio-press rounded-xl px-4 py-2 text-sm font-semibold"
            >
              {editingFolder ? 'Save' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
