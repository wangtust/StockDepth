'use client';

import { memo } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

type TextAlign = 'left' | 'center' | 'right';

const headingClasses = {
  1: 'mt-1 scroll-m-20 text-3xl font-semibold leading-tight text-slate-950',
  2: 'mt-8 scroll-m-20 border-b border-slate-200 pb-2 text-2xl font-semibold leading-tight text-slate-950',
  3: 'mt-7 scroll-m-20 text-xl font-semibold leading-snug text-slate-950',
  4: 'mt-6 scroll-m-20 text-lg font-semibold leading-snug text-slate-950',
  5: 'mt-5 scroll-m-20 text-base font-semibold leading-snug text-slate-950',
  6: 'mt-5 scroll-m-20 text-sm font-semibold uppercase tracking-wide text-slate-500'
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const normalizedContent = content.replace(/\r\n/g, '\n').trim();

  if (!normalizedContent) {
    return (
      <p className="text-sm text-muted-foreground">
        This report is empty.
      </p>
    );
  }

  return (
    <div
      className={cn(
        'space-y-5 text-[15px] leading-7 text-slate-700',
        className
      )}
    >
      {renderBlocks(normalizedContent.split('\n'))}
    </div>
  );
});

function renderBlocks(lines: string[]): ReactNode[] {
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index]?.trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <figure
          key={`code-${index}`}
          className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950"
        >
          {language && (
            <figcaption className="border-b border-white/10 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              {language}
            </figcaption>
          )}
          <pre className="overflow-x-auto p-4 text-sm leading-6 text-slate-100">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </figure>
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push(renderHeading(level, heading[2], `heading-${index}`));
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`rule-${index}`} className="border-slate-200" />);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index] ?? '');
      const alignments = splitTableRow(lines[index + 1] ?? '').map(getAlignment);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && isTableLine(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }

      blocks.push(
        <div key={`table-${index}`} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {header.map((cell, cellIndex) => (
                  <th
                    key={`head-${cellIndex}`}
                    className="border-b border-slate-200 px-4 py-3 font-semibold"
                    style={{ textAlign: alignments[cellIndex] ?? 'left' }}
                  >
                    {renderInline(cell, `table-head-${index}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="odd:bg-white even:bg-slate-50/60">
                  {header.map((_, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="px-4 py-3 align-top"
                      style={{ textAlign: alignments[cellIndex] ?? 'left' }}
                    >
                      {renderInline(row[cellIndex] ?? '', `table-${index}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];

      while (index < lines.length && /^>\s?/.test((lines[index] ?? '').trim())) {
        quoteLines.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }

      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-4 border-emerald-500 bg-emerald-50/70 px-5 py-4 text-slate-700"
        >
          <MarkdownRenderer content={quoteLines.join('\n')} />
        </blockquote>
      );
      continue;
    }

    const unorderedList = /^[-*+]\s+/.test(trimmed);
    const orderedList = /^\d+\.\s+/.test(trimmed);
    if (unorderedList || orderedList) {
      const items: string[] = [];
      const matcher = orderedList ? /^\d+\.\s+/ : /^[-*+]\s+/;

      while (index < lines.length && matcher.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(matcher, ''));
        index += 1;
      }

      const renderedItems = items.map((item, itemIndex) => (
        <li key={`item-${itemIndex}`} className="pl-1">
          {renderInline(item, `list-${index}-${itemIndex}`)}
        </li>
      ));

      blocks.push(
        orderedList ? (
          <ol key={`ol-${index}`} className="list-decimal space-y-2 pl-6 marker:text-slate-400">
            {renderedItems}
          </ol>
        ) : (
          <ul key={`ul-${index}`} className="list-disc space-y-2 pl-6 marker:text-emerald-500">
            {renderedItems}
          </ul>
        )
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isSpecialBlock(lines, index)) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-line">
        {renderInline(paragraphLines.join('\n').trim(), `paragraph-${index}`)}
      </p>
    );
  }

  return blocks;
}

function renderHeading(level: 1 | 2 | 3 | 4 | 5 | 6, text: string, key: string) {
  const children = renderInline(text, key);

  switch (level) {
    case 1:
      return <h1 key={key} className={headingClasses[1]}>{children}</h1>;
    case 2:
      return <h2 key={key} className={headingClasses[2]}>{children}</h2>;
    case 3:
      return <h3 key={key} className={headingClasses[3]}>{children}</h3>;
    case 4:
      return <h4 key={key} className={headingClasses[4]}>{children}</h4>;
    case 5:
      return <h5 key={key} className={headingClasses[5]}>{children}</h5>;
    case 6:
      return <h6 key={key} className={headingClasses[6]}>{children}</h6>;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let lastIndex = 0;
  let tokenIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${tokenIndex}`;
    const [raw, linkText, href, code, boldAsterisk, boldUnderscore, strike, italicAsterisk, italicUnderscore] =
      match;

    if (linkText && href) {
      const safeHref = getSafeHref(href);
      nodes.push(
        safeHref ? (
          <a
            key={key}
            href={safeHref}
            target={isExternalHref(safeHref) ? '_blank' : undefined}
            rel={isExternalHref(safeHref) ? 'noreferrer' : undefined}
            className="font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900"
          >
            {renderInline(linkText, `${key}-link`)}
          </a>
        ) : (
          linkText
        )
      );
    } else if (code) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-900"
        >
          {code}
        </code>
      );
    } else if (boldAsterisk || boldUnderscore) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-950">
          {renderInline(boldAsterisk || boldUnderscore || '', `${key}-strong`)}
        </strong>
      );
    } else if (strike) {
      nodes.push(
        <del key={key} className="text-slate-500">
          {renderInline(strike, `${key}-strike`)}
        </del>
      );
    } else if (italicAsterisk || italicUnderscore) {
      nodes.push(
        <em key={key} className="text-slate-800">
          {renderInline(italicAsterisk || italicUnderscore || '', `${key}-em`)}
        </em>
      );
    } else {
      nodes.push(raw);
    }

    lastIndex = pattern.lastIndex;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isSpecialBlock(lines: string[], index: number) {
  const trimmed = (lines[index] ?? '').trim();

  return (
    !trimmed ||
    trimmed.startsWith('```') ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    isTableStart(lines, index)
  );
}

function isTableStart(lines: string[], index: number) {
  return isTableLine(lines[index] ?? '') && isTableDivider(lines[index + 1] ?? '');
}

function isTableLine(line: string) {
  return line.includes('|') && line.trim().length > 0;
}

function isTableDivider(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function splitTableRow(row: string) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function getAlignment(cell: string): TextAlign {
  const trimmed = cell.trim();
  const startsWithColon = trimmed.startsWith(':');
  const endsWithColon = trimmed.endsWith(':');

  if (startsWithColon && endsWithColon) {
    return 'center';
  }

  if (endsWithColon) {
    return 'right';
  }

  return 'left';
}

function getSafeHref(href: string) {
  const trimmed = href.trim();

  if (!trimmed) {
    return undefined;
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}
