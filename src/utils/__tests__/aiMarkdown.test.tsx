// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AiRichText } from '../../components/editor/AiRichText';
import {
  formatAiMarkdownForTextbox,
  latexToReadableUnicode,
  parseMarkdownBlocks,
  parseMarkdownInline,
} from '../aiMarkdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCREENSHOT_GEMINI_RESPONSE = `Based on your handwritten notes, here is a mathematical representation of the abstract geometric structure shown:

### 1. Outer Diamond/Rhombus Boundary
The overall frame can be modeled as a warped rhombus or quadrilateral formed by four vertices $(x_i, y_i)$:
* **Top vertex:** $V_1 \\approx (0.73, 0.95)$
* **Right vertex:** $V_2 \\approx (0.95, 0.45)$
* **Bottom vertex:** $V_3 \\approx (0.32,
0.03)$
* **Left vertex:** $V_4 \\approx (0.02, 0.35)$

Represented as a piecewise linear boundary $\\partial\\Omega$:
$$\\partial\\Omega = \\bigcup_{i=1}^{4}
\\overline{V_i V_{i+1}} \\quad (\\text{with } V_5 =
V_1)$$

---

### 2. Internal Vertical Curves (Parametric Functions)
The inner vertical lines act like parabolas or elongated sinusoidal waves extending downwards:
* **Left arc:** $x(t) \\approx 0.3 + 0.05\\sin(\\pi t)$, for $y \\in [0.25, 0.75]$`;

describe('AI Markdown & KaTeX LaTeX renderer + Textbox formatter', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container?.remove();
    container = null;
  });

  function renderRich(content: string, inline = false): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<AiRichText content={content} inline={inline} />);
    });
    return container;
  }

  it('renders headings, bold list items, horizontal rule, wrapped inline math, and display KaTeX from Gemini geometry output', () => {
    const el = renderRich(SCREENSHOT_GEMINI_RESPONSE);

    const h3s = Array.from(el.querySelectorAll('h3')).map((h) => h.textContent);
    expect(h3s).toEqual([
      '1. Outer Diamond/Rhombus Boundary',
      '2. Internal Vertical Curves (Parametric Functions)',
    ]);

    const listItems = el.querySelectorAll('ul > li');
    expect(listItems.length).toBeGreaterThanOrEqual(5);
    const strongLabels = Array.from(el.querySelectorAll('li > strong')).map(
      (s) => s.textContent,
    );
    expect(strongLabels).toContain('Top vertex:');
    expect(strongLabels).toContain('Bottom vertex:');
    expect(strongLabels).toContain('Left arc:');

    expect(el.querySelectorAll('hr')).toHaveLength(1);

    const katexNodes = el.querySelectorAll('.katex');
    expect(katexNodes.length).toBeGreaterThanOrEqual(8);
    expect(el.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(el.querySelectorAll('[data-testid="ai-math-block"]')).toHaveLength(1);
    expect(el.querySelectorAll('.katex-display')).toHaveLength(1);

    // Strip hidden MathML <annotation encoding="application/x-tex"> to inspect visible rendered DOM text
    const visualClone = el.cloneNode(true) as HTMLElement;
    visualClone.querySelectorAll('.katex-mathml').forEach((n) => n.remove());
    const visibleText = visualClone.textContent ?? '';
    expect(visibleText).not.toContain('###');
    expect(visibleText).not.toContain('**');
    expect(visibleText).not.toContain('$$');
    expect(visibleText).not.toContain('\\approx');
    expect(visibleText).not.toContain('\\bigcup');
    expect(visibleText).toContain('≈');
    expect(visibleText).toContain('∂Ω');
    expect(visibleText).toContain('⋃');
    expect(visibleText).toContain('π');
    expect(visibleText).toContain('∈');
  });

  it('supports \\(...\\) / \\[...\\], tables, blockquotes, and code spans without mangling currency $ or snake_case', () => {
    // Currency amounts must stay literal prose
    const currencyEl = renderRich('It costs $5 or $10 total, and snake_case_var stays plain.');
    expect(currencyEl.querySelectorAll('.katex')).toHaveLength(0);
    expect(currencyEl.querySelectorAll('em')).toHaveLength(0);
    expect(currencyEl.textContent).toBe('It costs $5 or $10 total, and snake_case_var stays plain.');

    // Inline math with numbers after closing is allowed when not followed immediately by a digit
    const mathWithNumbers = parseMarkdownInline('Compute $5 + 3 = 8$ and \\(a^2 + b^2 = c^2\\).');
    expect(mathWithNumbers.filter((n) => n.type === 'math')).toHaveLength(2);

    // Inline code and fenced code blocks protect $ and * from math/emphasis parsing
    const rich = `Here is inline code \`$x^2$ and *raw*\` plus block math:

\\[
E = mc^2
\\]

> Important: **Keep note**

| Term | Formula |
| --- | --- |
| Area | $A = \\pi r^2$ |

\`\`\`ts
const cost = "$x^2$";
\`\`\``;

    const blocks = parseMarkdownBlocks(rich);
    expect(blocks.some((b) => b.type === 'math-block')).toBe(true);
    expect(blocks.some((b) => b.type === 'blockquote')).toBe(true);
    expect(blocks.some((b) => b.type === 'table')).toBe(true);
    expect(blocks.some((b) => b.type === 'code-block')).toBe(true);

    // Clean unmount of previous container before second render
    act(() => {
      root?.unmount();
    });
    container?.remove();
    const richEl = renderRich(rich);
    expect(richEl.querySelector('code')?.textContent).toContain('$x^2$ and *raw*');
    expect(richEl.querySelectorAll('.katex')).toHaveLength(2);
    expect(richEl.querySelector('table th')?.textContent).toBe('Term');
    expect(richEl.querySelector('blockquote strong')?.textContent).toBe('Keep note');
  });

  it('neutralizes unsafe links and HTML tags safely and handles malformed LaTeX without throwing', () => {
    const el = renderRich(
      'Try [safe](https://example.com) and [xss](javascript:alert(1)) <script>alert(1)</script> and $\\unknowncmd{$',
    );
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('formats Markdown & LaTeX into clean Unicode text for Canvas2D textboxes while leaving plain text intact', () => {
    expect(
      formatAiMarkdownForTextbox('Key takeaway: Force equals mass times acceleration.'),
    ).toBe('Key takeaway: Force equals mass times acceleration.');

    expect(formatAiMarkdownForTextbox('Costs $5 or $10 and foo_bar_baz.')).toBe(
      'Costs $5 or $10 and foo_bar_baz.',
    );

    expect(latexToReadableUnicode('\\frac{1}{2} + \\sqrt{x^2 + y_1}')).toBe(
      '1/2 + √(x² + y₁)',
    );

    const formatted = formatAiMarkdownForTextbox(SCREENSHOT_GEMINI_RESPONSE);
    expect(formatted).not.toContain('###');
    expect(formatted).not.toContain('**');
    expect(formatted).not.toContain('$$');
    expect(formatted).toContain('1. Outer Diamond/Rhombus Boundary');
    expect(formatted).toContain('• Top vertex: V₁ ≈ (0.73, 0.95)');
    expect(formatted).toContain('∂Ω = ⋃');
    expect(formatted).toContain('V₅ = V₁');
    expect(formatted).toContain('π');
    expect(formatted).toContain('∈ [0.25, 0.75]');
  });
});
