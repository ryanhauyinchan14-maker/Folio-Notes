// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_PRESETS } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { db } from '../../../db/database';
import {
  buildStandaloneNoteHtml,
  computeNoteStats,
  extractNoteOutline,
  noteJsonToMarkdown,
} from '../../../notes/noteExport';
import { useAppStore } from '../../../store/useAppStore';
import { generateRecoveryKey } from '../../../utils/vaultCrypto';
import { NotesEditor } from '../NotesEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function resetDb() {
  await db.folders.clear();
  await db.notebooks.clear();
  await db.pages.clear();
  await db.templates.clear();
  await db.pdfAssets.clear();
  await db.trashedNotebooks.clear();
  useAppStore.setState({
    activeNotebook: null,
    pages: [],
    activePageId: null,
    unlockedMasterKey: null,
  });
}

describe('Milestone 2: Google Docs-style Notes Mode', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await resetDb();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await resetDb();
    vi.restoreAllMocks();
  });

  it('computes stats, extracts H1-H3 outline, and serializes Markdown & standalone HTML accurately', () => {
    const sampleDoc: Record<string, unknown> = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Lecture One' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Key idea: ' },
            { type: 'text', text: 'conservation', marks: [{ type: 'bold' }] },
          ],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Checklist' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Derive formula' }] }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Term' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'g' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '9.81' }] }] },
              ],
            },
          ],
        },
        { type: 'mathBlock', attrs: { latex: 'F = ma' } },
      ],
    };

    const stats = computeNoteStats('Lecture One key idea conservation');
    expect(stats.words).toBe(5);
    expect(stats.readingMinutes).toBe(1);

    const outline = extractNoteOutline(sampleDoc);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({ level: 1, text: 'Lecture One' });
    expect(outline[1]).toMatchObject({ level: 2, text: 'Checklist' });

    const md = noteJsonToMarkdown(sampleDoc);
    expect(md).toContain('# Lecture One');
    expect(md).toContain('**conservation**');
    expect(md).toContain('- [x] Derive formula');
    expect(md).toContain('| Term | Value |');
    expect(md).toContain('$$\nF = ma\n$$');

    const html = buildStandaloneNoteHtml('Physics', '<p>Hello World</p>');
    expect(html).toContain('<title>Physics</title>');
    expect(html).toContain('<p>Hello World</p>');
  });

  it('renders NotesEditor with formatting toolbar, outline sidebar, table/checklist insertion, and Vault encryption round-trip', async () => {
    let noteId = '';
    await act(async () => {
      await useAppStore.getState().initApp();
      const nb = await useAppStore.getState().createNotebook({
        title: 'Research Draft',
        mode: 'notes',
        folderId: null,
        cover: COVER_PRESETS[1].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
      noteId = nb.id;
      root.render(<NotesEditor />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(container.querySelector('[data-testid="notes-editor-shell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="notes-formatting-toolbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="notes-outline-sidebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="notes-status-bar"]')?.textContent).toContain('0 words');

    // Toggle Paginated <-> Pageless view
    const styleBtn = container.querySelector<HTMLButtonElement>('[data-testid="notes-page-style-toggle"]')!;
    expect(styleBtn.textContent).toBe('Pages');
    await act(async () => {
      styleBtn.click();
    });
    expect(styleBtn.textContent).toBe('Pageless');

    // Insert a table via toolbar button and confirm contextual table sub-bar appears
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="notes-insert-table-btn"]')!.click();
    });
    expect(container.querySelector('[data-testid="notes-table-subbar"]')).not.toBeNull();

    // Close / unmount NotesEditor cleanly, wait for any queued save, then verify direct noteData persistence + Vault round-trip
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
      root.unmount();
    });

    await act(async () => {
      const pageId = useAppStore.getState().pages[0].id;
      useAppStore.getState().saveNotePageData(pageId, {
        contentJson: {
          type: 'doc',
          content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Encrypted Section' }] }],
        },
        contentHtml: '<h1>Encrypted Section</h1>',
        plainText: 'Encrypted Section',
        pageStyle: 'pageless',
        pageMargins: 'normal',
        defaultFont: 'Inter, system-ui, sans-serif',
      });
      await new Promise((r) => setTimeout(r, 40));
    });

    const recoveryKey = generateRecoveryKey();
    await act(async () => {
      await useAppStore.getState().closeNotebook();
      await useAppStore.getState().setupVaultAndMaybeLockNotebook('notes-vault-pass', recoveryKey, noteId);
      await useAppStore.getState().unlockNotebookWithPassword(noteId, 'notes-vault-pass', 'open');
    });

    // Re-create root cleanly for afterEach unmount
    root = createRoot(container);

    expect(useAppStore.getState().activeNotebook?.mode).toBe('notes');
    expect(useAppStore.getState().pages[0]?.noteData?.plainText).toBe('Encrypted Section');
  });
});
