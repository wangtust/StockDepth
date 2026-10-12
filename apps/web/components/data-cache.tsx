'use client';
import { useState } from 'react';
import { SWRConfig } from 'swr';
import { pollingDefaults } from '@/lib/http/polling';

export function DataCache({ fallback, children }: {
  fallback: Record<string, unknown>; children: React.ReactNode;
}) {
  const [cache] = useState(() => new Map());
  return <SWRConfig value={{ ...pollingDefaults, provider: () => cache, fallback }}>
    {children}
  </SWRConfig>;
}
