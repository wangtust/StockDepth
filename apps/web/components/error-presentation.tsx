'use client';

import { presentError, type ErrorContext, type PresentedError } from '@/lib/analysis/error-presentation';

export type ErrorPresentationProps = {
  error: unknown;
  presentation?: PresentedError;
  onDismiss?: () => void;
  jobId?: number;
  compact?: boolean;
  context?: ErrorContext;
  onRetry?: () => void;
  retrying?: boolean;
};

export function ErrorPresentation({ error, presentation, onDismiss, jobId, compact = false, context = 'analysis', onRetry, retrying = false }: ErrorPresentationProps) {
  const message = presentation ?? presentError(error, context);
  const safeJobId = typeof jobId === 'number' && Number.isSafeInteger(jobId) && jobId > 0 ? jobId : undefined;
  return (
    <div role="alert" className={`min-w-0 [overflow-wrap:anywhere] rounded-lg border border-red-200 bg-red-50 text-red-800 ${compact ? 'p-3 text-xs' : 'p-4 text-sm'}`}>
      <p className="font-semibold">{message.title}</p>
      {safeJobId !== undefined && <p className="mt-1">Job #{safeJobId}</p>}
      <p className="mt-1">{message.description}</p>
      <p className="mt-2 text-red-700">{message.nextStep}</p>
      {onDismiss && <button type="button" onClick={onDismiss} className="mt-3 mr-2 rounded-md border border-red-300 px-3 py-2 font-medium">Dismiss</button>}
      {onRetry && <button type="button" onClick={onRetry} disabled={retrying} aria-busy={retrying} className="mt-3 rounded-md border border-red-300 px-3 py-2 font-medium focus-visible:outline focus-visible:outline-2">{retrying ? 'Retrying…' : 'Retry'}</button>}
    </div>
  );
}
