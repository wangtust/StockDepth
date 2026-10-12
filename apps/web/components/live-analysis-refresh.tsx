'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function LiveAnalysisRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [enabled, router]);
  return null;
}
