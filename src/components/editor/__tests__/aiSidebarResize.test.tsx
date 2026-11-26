// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import type { Page } from '../../../types/notes';
import {
  AI_SIDEBAR_DEFAULT_WIDTH,
  AI_SIDEBAR_MIN_WIDTH,
  AiSidebar,
  computeAiSidebarMaxWidth,
} from '../AiSidebar';
import { BottomDocks } from '../BottomDocks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createPage(): Page {
  return {
    id: 'page-resize-1',
    notebookId: 'nb-resize-1',
    paper: { ...DEFAULT_PAPER_CONFIG },
    strokes: [],
    textboxes: [],
    images: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
) {
  const evt =
    typeof PointerEvent !== 'undefined'
      ? new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY: 240,
          button: 0,
          pointerType: 'mouse',
        })
      : Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 240, button: 0 }), {
          pointerType: 'mouse',
        });
  target.dispatchEvent(evt);
}

describe('Resizable AI Study Suite Sidebar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('computes wide max widths when empty desk space surrounds the page and clamps on narrow viewports', () => {
    // 1920px wide screen with 816px page: ~1040px empty space -> sidebar can expand up to ~1040px
    const wideMax = computeAiSidebarMaxWidth({
      containerWidth: 1920,
      drawerOpen: false,
      isWhiteboard: false,
      pageCssWidth: 816,
    });
    expect(wideMax).toBeGreaterThanOrEqual(960);

    // Opening the left Pages drawer reduces available horizontal space cleanly
    const wideWithDrawer = computeAiSidebarMaxWidth({
      containerWidth: 1920,
      drawerOpen: true,
      isWhiteboard: false,
      pageCssWidth: 816,
    });
    expect(wideWithDrawer).toBeLessThan(wideMax);
    expect(wideWithDrawer).toBeGreaterThan(600);

    // Narrow viewport never dips below minimum sidebar width
    const narrowMax = computeAiSidebarMaxWidth({
      containerWidth: 640,
      drawerOpen: false,
      isWhiteboard: false,
      pageCssWidth: 816,
    });
    expect(narrowMax).toBe(AI_SIDEBAR_MIN_WIDTH);
  });

  it('expands width on left-edge drag, clamps cleanly, resets on double-click, and updates BottomDocks offset', async () => {
    const page = createPage();
    let currentWidth = AI_SIDEBAR_DEFAULT_WIDTH;

    const Harness = ({ maxWidth = 900 }: { maxWidth?: number }) => {
      return (
        <AiSidebar
          open
          activePage={page}
          activePageIndex={0}
          pages={[page]}
          pendingLassoAction={null}
          onConsumePendingLassoAction={vi.fn()}
          onInsertTextbox={vi.fn()}
          onInsertImageDataUrl={vi.fn(async () => {})}
          onOpenSettings={vi.fn()}
          onClose={vi.fn()}
          maxWidth={maxWidth}
          onWidthChange={(w) => {
            currentWidth = w;
          }}
          onResetWidth={() => {
            currentWidth = AI_SIDEBAR_DEFAULT_WIDTH;
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const aside = container.querySelector<HTMLElement>('[data-testid="ai-sidebar"]')!;
    const handle = container.querySelector<HTMLElement>('[data-testid="ai-sidebar-resize-handle"]')!;
    expect(aside.style.width).toBe('340px');
    expect(handle).not.toBeNull();

    // Drag left by 320px -> 340 + 320 = 660px
    await act(async () => {
      dispatchPointer(handle, 'pointerdown', 1000);
      dispatchPointer(window, 'pointermove', 680);
      dispatchPointer(window, 'pointerup', 680);
    });
    expect(currentWidth).toBe(660);
    expect(aside.style.width).toBe('660px');

    // Drag past maxWidth (900px) -> clamps cleanly to 900px
    await act(async () => {
      dispatchPointer(handle, 'pointerdown', 680);
      dispatchPointer(window, 'pointermove', 100);
      dispatchPointer(window, 'pointerup', 100);
    });
    expect(currentWidth).toBe(900);
    expect(aside.style.width).toBe('900px');

    // Double-click resets back to default 340px
    await act(async () => {
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(currentWidth).toBe(AI_SIDEBAR_DEFAULT_WIDTH);
    expect(aside.style.width).toBe('340px');

    // Verify BottomDocks derives dynamic --ai-sidebar-offset from aiSidebarWidth
    await act(async () => {
      root.render(
        <BottomDocks
          pageIndex={0}
          totalPages={1}
          spacePressed={false}
          aiSidebarOpen
          aiSidebarWidth={680}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
          onFitWidth={vi.fn()}
        />,
      );
    });
    const dockWrapper = container.querySelector<HTMLElement>('[style*="--ai-sidebar-offset"]');
    expect(dockWrapper).not.toBeNull();
    expect(dockWrapper!.style.getPropertyValue('--ai-sidebar-offset')).toBe('696px');
  });
});
