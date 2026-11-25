import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../..');

function collectUiFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      results.push(...collectUiFiles(full));
    } else if (
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx') &&
      entry.name !== 'CoverPreview.tsx'
    ) {
      results.push(full);
    }
  }
  return results;
}

describe('Glassy UI Surface Audit (No Dark Blue Buttons / Displays)', () => {
  it('defines luminous frosted glass tokens and utilities in src/index.css without solid navy button styles', () => {
    const css = fs.readFileSync(path.join(SRC_ROOT, 'index.css'), 'utf8');
    expect(css).toContain('--glass-accent-bg:');
    expect(css).toContain('.folio-glass-active');
    expect(css).toContain('.folio-glass-badge');
    expect(css).toContain('.folio-glass-toggle-on');
    expect(css).toMatch(/\.folio-morph-pill\s*\{[^}]*var\(--glass-accent-bg\)/s);
    expect(css).toMatch(/\.folio-btn-navy\s*\{[^}]*var\(--glass-accent-bg\)/s);
    expect(css).not.toMatch(/\.folio-btn-navy\s*\{[^}]*background-color:\s*var\(--navy-900\)/s);
    expect(css).not.toMatch(/\.folio-morph-pill\s*\{[^}]*background-color:\s*var\(--navy-900\)/s);
  });

  it('contains zero dark-blue button, pill, toggle, badge, or hover backgrounds across all UI components', () => {
    const files = [
      path.join(SRC_ROOT, 'App.tsx'),
      ...collectUiFiles(path.join(SRC_ROOT, 'components')),
    ];

    const forbiddenPatterns: Array<{ label: string; regex: RegExp }> = [
      { label: 'navy-900 solid or high-opacity bg', regex: /bg-\[var\(--navy-900\)\](?!\/(?:1\d|2\d)\b)/ },
      { label: 'navy-800 bg', regex: /bg-\[var\(--navy-800\)\]/ },
      { label: 'navy-950 bg', regex: /bg-\[var\(--navy-950\)\]/ },
      { label: 'hex 072D59 solid or high-opacity bg', regex: /bg-\[#072D59\](?!\/(?:1\d|2\d)\b)/ },
      { label: 'hover hex 0A3D7A bg', regex: /hover:bg-\[#0A3D7A\]/ },
      { label: 'hover navy var bg', regex: /hover:bg-\[var\(--navy-/ },
      { label: 'dark tailwind slate/blue/gray bg', regex: /bg-(?:slate|blue|indigo|sky|gray|zinc)-(?:800|900|950)\b/ },
    ];

    const violations: string[] = [];

    for (const filePath of files) {
      const rel = path.relative(SRC_ROOT, filePath).replace(/\\/g, '/');
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const { label, regex } of forbiddenPatterns) {
          if (regex.test(line)) {
            violations.push(`${rel}:${idx + 1} [${label}] -> ${line.trim()}`);
          }
        }
        // MorphingPill ready state must use crisp white text over darker smoked slate-blue glass
        if (
          /Indicator\.ready/.test(line) &&
          lines.slice(idx, idx + 3).some((l) => /['"`][^'"`]*text-\[var\(--navy-900\)\]/.test(l))
        ) {
          violations.push(`${rel}:${idx + 1} [MorphingPill low-contrast dark text] -> ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
