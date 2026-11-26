import React, { useState } from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import katex from 'katex';

export const CalloutBlock = Node.create({
  name: 'calloutBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'info',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-tone') || 'info',
        renderHTML: (attrs) => ({ 'data-tone': attrs.tone || 'info' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': 'true' }),
      0,
    ];
  },
});

const MathBlockNodeView: React.FC<NodeViewProps> = ({ node, updateAttributes, selected }) => {
  const latex = String(node.attrs.latex ?? '');
  const [editing, setEditing] = useState(!latex);

  let renderedHtml = '';
  let renderError = false;
  if (latex.trim()) {
    try {
      renderedHtml = katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      renderError = true;
    }
  }

  return React.createElement(
    NodeViewWrapper,
    {
      className: `folio-notes-math-block my-3 rounded-xl border px-4 py-3 ${
        selected
          ? 'border-[var(--crimson-500)] ring-2 ring-[var(--crimson-glow)]'
          : 'border-[var(--border-subtle)]'
      }`,
      'data-testid': 'notes-math-block',
    },
    editing
      ? React.createElement(
          'div',
          { className: 'space-y-2' },
          React.createElement(
            'div',
            { className: 'flex items-center justify-between gap-2 text-[11px] font-bold text-[var(--navy-600)]' },
            React.createElement('span', null, 'LaTeX Equation'),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => setEditing(false),
                className: 'folio-btn-navy rounded-lg px-2 py-0.5 text-[10px] font-semibold',
              },
              'Done',
            ),
          ),
          React.createElement('input', {
            type: 'text',
            value: latex,
            placeholder: 'e.g. x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              updateAttributes({ latex: e.target.value }),
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            },
            className: 'folio-input w-full rounded-lg px-2.5 py-1.5 font-mono text-xs',
            autoFocus: true,
          }),
          latex.trim() && renderedHtml
            ? React.createElement('div', {
                className: 'overflow-x-auto pt-1 text-center',
                dangerouslySetInnerHTML: { __html: renderedHtml },
              })
            : null,
        )
      : React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setEditing(true),
            title: 'Click to edit LaTeX equation',
            className: 'block w-full cursor-pointer text-center',
          },
          latex.trim() && !renderError
            ? React.createElement('div', {
                className: 'overflow-x-auto',
                dangerouslySetInnerHTML: { __html: renderedHtml },
              })
            : React.createElement(
                'span',
                { className: 'font-mono text-xs text-[var(--navy-600)]' },
                latex.trim() || 'Click to enter LaTeX math…',
              ),
        ),
  );
};

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: 'E = mc^2',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-latex') || '',
        renderHTML: (attrs) => ({ 'data-latex': String(attrs.latex ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': 'true' }),
      `$$${String(HTMLAttributes['data-latex'] ?? '')}$$`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockNodeView);
  },
});

export function createNotesExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
    }),
    TextStyle,
    FontFamily,
    FontSize,
    LineHeight,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Image.configure({ allowBase64: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading'
          ? 'Heading'
          : 'Start writing, or type "/" for commands…',
    }),
    CalloutBlock,
    MathBlock,
  ];
}
