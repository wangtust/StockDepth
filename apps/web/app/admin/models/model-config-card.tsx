'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function ModelConfigCard({ configId, summary, children }: {
  configId: number;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = `model-config-content-${configId}`;

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-start gap-2 p-4 pr-16 text-left"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown aria-hidden="true" className={`mt-1 h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {summary}
      </button>
      <div id={contentId} hidden={!expanded} className="border-t border-slate-100 p-4">
        {children}
      </div>
    </div>
  );
}
