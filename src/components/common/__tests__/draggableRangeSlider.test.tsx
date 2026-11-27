import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { SettingsModal } from '../../modals/SettingsModal';
import {
  computeSliderValueFromClientX,
  DraggableRangeSlider,
} from '../DraggableRangeSlider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  coords: { clientX: number; clientY: number; button?: number; pointerId?: number },
): void {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    button: coords.button ?? 0,
  });
  Object.defineProperty(evt, 'pointerId', { value: coords.pointerId ?? 1 });
  Object.defineProperty(evt, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(evt);
}

describe('DraggableRangeSlider & Whole-App UI Scale dragging', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
      useAppStore.getState().setUiScale(1.35);
    });
  });

  afterEach(async () => {
    try {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      await act(async () => {
        useAppStore.getState().setUiScale(1.35);
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('computes snapped slider values across edges, midpoints, and out-of-bounds drags', () => {
    const rect = { left: 100, width: 318 }; // thumbRadius=9 -> trackLeft=109, usableWidth=300
    expect(computeSliderValueFromClientX(109, rect, 75, 150, 5)).toBe(75);
    expect(computeSliderValueFromClientX(40, rect, 75, 150, 5)).toBe(75);
    expect(computeSliderValueFromClientX(259, rect, 75, 150, 5)).toBe(115);
    expect(computeSliderValueFromClientX(409, rect, 75, 150, 5)).toBe(150);
    expect(computeSliderValueFromClientX(520, rect, 75, 150, 5)).toBe(150);
  });

  it('fires onChange continuously across pointermove even when pointer drifts vertically, and onCommit once on pointerup', async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    await act(async () => {
      root.render(
        <DraggableRangeSlider
          testId="unit-slider"
          ariaLabel="Unit slider"
          min={0}
          max={100}
          step={10}
          value={50}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    });

    const slider = container.querySelector<HTMLInputElement>('[data-testid="unit-slider"]')!;
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 218,
      height: 24,
      right: 318,
      bottom: 224,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });

    await act(async () => {
      dispatchPointer(slider, 'pointerdown', { clientX: 209, clientY: 204 });
    });
    expect(slider.getAttribute('data-dragging')).toBe('true');

    await act(async () => {
      // Drift 45px vertically off the track while dragging horizontally
      dispatchPointer(slider, 'pointermove', { clientX: 249, clientY: 249 });
    });
    expect(onChange).toHaveBeenLastCalledWith(70);
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      dispatchPointer(slider, 'pointermove', { clientX: 289, clientY: 165 });
    });
    expect(onChange).toHaveBeenLastCalledWith(90);
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      dispatchPointer(slider, 'pointerup', { clientX: 289, clientY: 165 });
    });
    expect(slider.getAttribute('data-dragging')).toBe('false');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(90);
  });

  it('lets Whole-App UI Scale drag smoothly via live preview without mid-drag zoom resizing, committing on release', async () => {
    const setUiScaleSpy = vi.spyOn(useAppStore.getState(), 'setUiScale');

    await act(async () => {
      root.render(<SettingsModal open={true} initialTab="appearance" onClose={() => {}} />);
    });

    const slider = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-ui-scale-slider"]',
    )!;
    expect(slider).not.toBeNull();

    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 300,
      width: 318,
      height: 24,
      right: 418,
      bottom: 324,
      x: 100,
      y: 300,
      toJSON: () => ({}),
    });

    // Click near upper half and drag smoothly across the expanded 75%-200% range (clientX=189 -> 110%)
    await act(async () => {
      dispatchPointer(slider, 'pointerdown', { clientX: 349, clientY: 312 });
    });
    await act(async () => {
      dispatchPointer(slider, 'pointermove', { clientX: 259, clientY: 340 });
    });
    await act(async () => {
      dispatchPointer(slider, 'pointermove', { clientX: 189, clientY: 350 });
    });

    // Live badge & input value track the drag smoothly while store zoom waits until release
    expect(
      container.querySelector('[data-testid="settings-ui-scale-value"]')?.textContent,
    ).toBe('110%');
    expect(slider.value).toBe('110');
    expect(setUiScaleSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().uiScale).toBe(1.35);

    await act(async () => {
      dispatchPointer(slider, 'pointerup', { clientX: 189, clientY: 350 });
    });

    expect(setUiScaleSpy).toHaveBeenCalledTimes(1);
    expect(setUiScaleSpy).toHaveBeenCalledWith(1.1);
    expect(useAppStore.getState().uiScale).toBe(1.1);
    expect(
      container.querySelector('[data-testid="settings-ui-scale-value"]')?.textContent,
    ).toBe('110%');
  });
});
