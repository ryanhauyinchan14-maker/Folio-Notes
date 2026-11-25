import React, { useMemo } from 'react';
import katex from 'katex';
import {
  type MarkdownBlockNode,
  type MarkdownInlineNode,
  parseMarkdownBlocks,
  parseMarkdownInline,
} from '../../utils/aiMarkdown';

interface AiRichTextProps {
  content: string;
  inline?: boolean;
  className?: string;
}

function renderKatexHtml(latex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return null;
  }
}

function renderInlineNodes(
  nodes: MarkdownInlineNode[],
  keyPrefix: string,
  forceInlineDisplay = false,
): React.ReactNode {
  return nodes.map((node, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (node.type) {
      case 'text':
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case 'break':
        return <br key={key} />;
      case 'code':
        return (
          <code
            key={key}
            className="rounded border border-[#072D59]/12 bg-white/85 px-1 py-0.5 font-mono text-[0.9em] text-[#072D59]"
          >
            {node.value}
          </code>
        );
      case 'math': {
        const displayMode = node.display && !forceInlineDisplay;
        const html = renderKatexHtml(node.latex, displayMode);
        if (html === null) {
          return (
            <code
              key={key}
              className="rounded bg-white/80 px-1 py-0.5 font-mono text-[0.9em] text-[#072D59]"
            >
              {node.latex}
            </code>
          );
        }
        if (displayMode) {
          return (
            <span
              key={key}
              data-testid="ai-math-block"
              className="folio-ai-math-block block"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        return (
          <span
            key={key}
            data-testid="ai-math-inline"
            className="folio-ai-math-inline"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      case 'strong':
        return (
          <strong key={key} className="font-bold text-[#072D59]">
            {renderInlineNodes(node.children, key, forceInlineDisplay)}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic">
            {renderInlineNodes(node.children, key, forceInlineDisplay)}
          </em>
        );
      case 'del':
        return (
          <del key={key} className="line-through opacity-75">
            {renderInlineNodes(node.children, key, forceInlineDisplay)}
          </del>
        );
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#072D59] underline decoration-[#FD6E88] underline-offset-2 hover:text-[#F95573]"
          >
            {renderInlineNodes(node.children, key, forceInlineDisplay)}
          </a>
        );
    }
  });
}

function renderBlockNodes(blocks: MarkdownBlockNode[], keyPrefix: string): React.ReactNode {
  return blocks.map((block, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (block.type) {
      case 'heading': {
        const content = renderInlineNodes(block.children, key);
        const clsMap: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
          1: 'mt-2.5 mb-1 first:mt-0 text-[13.5px] font-extrabold leading-snug text-[#072D59]',
          2: 'mt-2.5 mb-1 first:mt-0 text-[13px] font-bold leading-snug text-[#072D59]',
          3: 'mt-2.5 mb-1 first:mt-0 text-[12.5px] font-bold leading-snug text-[#072D59]',
          4: 'mt-2 mb-0.5 first:mt-0 text-xs font-bold leading-snug text-[#072D59]',
          5: 'mt-2 mb-0.5 first:mt-0 text-xs font-semibold leading-snug text-[#072D59]',
          6: 'mt-1.5 mb-0.5 first:mt-0 text-[11px] font-semibold leading-snug text-[#072D59]/85',
        };
        const HeadingTag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return (
          <HeadingTag key={key} className={clsMap[block.level]}>
            {content}
          </HeadingTag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="my-1.5 leading-relaxed first:mt-0 last:mb-0">
            {renderInlineNodes(block.children, key)}
          </p>
        );
      case 'math-block': {
        const html = renderKatexHtml(block.latex, true);
        if (html === null) {
          return (
            <pre
              key={key}
              className="my-1.5 overflow-x-auto rounded-lg border border-[#072D59]/12 bg-white/85 px-2.5 py-1.5 font-mono text-[11px] text-[#072D59]"
            >
              <code>{block.latex}</code>
            </pre>
          );
        }
        return (
          <div
            key={key}
            data-testid="ai-math-block"
            className="folio-ai-math-block"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      case 'code-block':
        return (
          <pre
            key={key}
            className="my-1.5 overflow-x-auto rounded-xl border border-[#072D59]/12 bg-white/90 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[#072D59]"
          >
            <code>{block.code}</code>
          </pre>
        );
      case 'hr':
        return <hr key={key} className="my-2.5 border-0 border-t border-[#072D59]/15" />;
      case 'blockquote':
        return (
          <blockquote
            key={key}
            className="my-1.5 border-l-2 border-[#FD6E88] pl-2.5 text-[#072D59]/85"
          >
            {renderBlockNodes(block.children, key)}
          </blockquote>
        );
      case 'list': {
        if (block.ordered) {
          return (
            <ol
              key={key}
              start={block.start > 1 ? block.start : undefined}
              className="my-1.5 list-decimal space-y-1 pl-4 leading-relaxed first:mt-0 last:mb-0"
            >
              {block.items.map((item, itemIdx) => (
                <li key={`${key}-li-${itemIdx}`}>
                  {renderInlineNodes(item, `${key}-li-${itemIdx}`)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <ul
            key={key}
            className="my-1.5 list-disc space-y-1 pl-4 leading-relaxed first:mt-0 last:mb-0"
          >
            {block.items.map((item, itemIdx) => (
              <li key={`${key}-li-${itemIdx}`}>
                {renderInlineNodes(item, `${key}-li-${itemIdx}`)}
              </li>
            ))}
          </ul>
        );
      }
      case 'table':
        return (
          <div
            key={key}
            className="my-2 overflow-x-auto rounded-lg border border-[#072D59]/12 bg-white"
          >
            <table className="min-w-full border-collapse text-[11px]">
              <thead className="bg-[#DBF2FC]/45">
                <tr>
                  {block.headers.map((cell, cIdx) => (
                    <th
                      key={`${key}-th-${cIdx}`}
                      className="border-b border-[#072D59]/12 px-2 py-1 text-left font-bold text-[#072D59]"
                    >
                      {renderInlineNodes(cell, `${key}-th-${cIdx}`, true)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rIdx) => (
                  <tr
                    key={`${key}-tr-${rIdx}`}
                    className="border-t border-[#072D59]/10 even:bg-[#F4F8FB]/60"
                  >
                    {row.map((cell, cIdx) => (
                      <td key={`${key}-td-${rIdx}-${cIdx}`} className="px-2 py-1 text-[#072D59]">
                        {renderInlineNodes(cell, `${key}-td-${rIdx}-${cIdx}`, true)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export const AiRichText: React.FC<AiRichTextProps> = ({
  content,
  inline = false,
  className = '',
}) => {
  const inlineNodes = useMemo(
    () => (inline ? parseMarkdownInline(content) : null),
    [content, inline],
  );
  const blockNodes = useMemo(
    () => (inline ? null : parseMarkdownBlocks(content)),
    [content, inline],
  );

  if (inline) {
    return (
      <span className={className ? `folio-ai-rich-inline ${className}` : 'folio-ai-rich-inline'}>
        {renderInlineNodes(inlineNodes ?? [], 'inl', true)}
      </span>
    );
  }

  return (
    <div className={className ? `folio-ai-markdown ${className}` : 'folio-ai-markdown'}>
      {renderBlockNodes(blockNodes ?? [], 'blk')}
    </div>
  );
};
