'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function NavigationPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span data-navigation-pending role="status" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-emerald-500/10">
      <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
      <span className="sr-only">Opening page…</span>
    </span>
  );
}

/** Keep Next's partial prefetch and native cancellation/error lifecycle. */
export function NavigationLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={cn('relative', className)}>
      {children}
      <NavigationPending />
    </Link>
  );
}
