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
        className="folio-modal-card w-full max-w-sm overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
              <FolderPlus className="h-4 w-4" />
            </div>
            <h2 id="folder-modal-title" className="text-base font-bold text-[#072D59]">
              {editingFolder ? 'Edit Folder' : 'New Folder'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close folder modal"
            onClick={onClose}
            className="rounded-lg p-1 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label
              htmlFor="folder-name-input"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
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
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
              Folder Color
            </label>
            <div className="flex items-center gap-2.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Folder color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition-transform duration-150 ${
                    color === c
                      ? 'scale-110 ring-2 ring-[#072D59] ring-offset-2'
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
              className="folio-btn-secondary rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="folio-btn-crimson rounded-xl px-4 py-2 text-sm font-semibold shadow-xs"
            >
              {editingFolder ? 'Save' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
