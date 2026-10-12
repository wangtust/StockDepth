'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/http/json-fetcher';
import { pollingDefaults } from '@/lib/http/polling';

export function LiveAnalysisRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { data } = useSWR(enabled ? '/api/admin/jobs/activity' : null, jsonFetcher, {
    ...pollingDefaults, refreshInterval: enabled ? 5000 : 0
  });
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const signature = JSON.stringify(data);
    if (previous.current !== null && previous.current !== signature) router.refresh();
    previous.current = signature;
  }, [data, router]);
  return null;
}
