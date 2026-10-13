'use client';

import { useState, type ReactNode } from 'react';

// Closed disclosures do not need to parse or mount their potentially large body.
export function DeferredDetails({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {open && children}
  </details>;
}
