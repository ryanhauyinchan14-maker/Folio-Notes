// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { ContextualSubBar } from '../ContextualSubBar';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function setRangeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('v1.4.18 Pen & Highlighter precision thickness dropdown slider (1 px to 15 px)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAppStore.setState({
      activeTool: 'pen',
      penSize: 4.5,
      highlighterSize: 22,
      lassoSelection: null,
      activeTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the 3 presets and opens a 1 px to 15 px precision slider popover from the down arrow', async () => {
    await act(async () => {
      root.render(<ContextualSubBar activePage={null} />);
    });

    // Presets remain intact
    expect(container.querySelector('button[aria-label="Thickness 2px"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Thickness 4.5px"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Thickness 8px"]')).not.toBeNull();

    // Popover closed initially
    expect(document.body.querySelector('[data-testid="thickness-slider-popover"]')).toBeNull();

    // Open dropdown via down arrow
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="thickness-slider-trigger"]',
    )!;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger.click();
    });

    const popover = document.body.querySelector<HTMLElement>(
      '[data-testid="thickness-slider-popover"]',
    )!;
    expect(popover).not.toBeNull();
    const slider = popover.querySelector<HTMLInputElement>(
      '[data-testid="thickness-precision-slider"]',
    )!;
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('15');
    expect(slider.step).toBe('0.5');
    expect(
      popover.querySelector('[data-testid="thickness-slider-value"]')?.textContent,
    ).toBe('4.5 px');

    // Adjust slider across 1 px -> 11.5 px -> 15 px
    await act(async () => {
      setRangeValue(slider, '1');
    });
    expect(useAppStore.getState().penSize).toBe(1);
    expect(
      popover.querySelector('[data-testid="thickness-slider-value"]')?.textContent,
    ).toBe('1 px');

    await act(async () => {
      setRangeValue(slider, '11.5');
    });
    expect(useAppStore.getState().penSize).toBe(11.5);
    expect(
      popover.querySelector('[data-testid="thickness-slider-value"]')?.textContent,
    ).toBe('11.5 px');

    await act(async () => {
      setRangeValue(slider, '15');
    });
    expect(useAppStore.getState().penSize).toBe(15);
    expect(
      popover.querySelector('[data-testid="thickness-slider-value"]')?.textContent,
    ).toBe('15 px');

    // Clicking a preset dot syncs the slider readout cleanly
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Thickness 8px"]')!.click();
    });
    expect(useAppStore.getState().penSize).toBe(8);
    expect(
      document.body.querySelector('[data-testid="thickness-slider-value"]')?.textContent,
    ).toBe('8 px');

    // Escape dismisses the popover
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.querySelector('[data-testid="thickness-slider-popover"]')).toBeNull();

    // Switching to Highlighter supports Highlighter range 6..48
    await act(async () => {
      useAppStore.getState().setActiveTool('highlighter');
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="thickness-slider-trigger"]')!
        .click();
    });
    const hlSlider = document.body.querySelector<HTMLInputElement>(
      '[data-testid="thickness-precision-slider"]',
    )!;
    expect(hlSlider.min).toBe('6');
    expect(hlSlider.max).toBe('48');

    // Outside click dismisses the popover
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(document.body.querySelector('[data-testid="thickness-slider-popover"]')).toBeNull();
  });
});
