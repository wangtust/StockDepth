import { presentError, type ErrorContext } from '@/lib/analysis/error-presentation';

export type ErrorPresentationProps = {
  error: unknown;
  jobId?: number;
  compact?: boolean;
  context?: ErrorContext;
};

export function ErrorPresentation({ error, jobId, compact = false, context = 'analysis' }: ErrorPresentationProps) {
  const message = presentError(error, context);
  const safeJobId = typeof jobId === 'number' && Number.isSafeInteger(jobId) && jobId > 0 ? jobId : undefined;
  return (
    <div role="alert" className={`min-w-0 rounded-lg border border-red-200 bg-red-50 text-red-800 ${compact ? 'p-3 text-xs' : 'p-4 text-sm'}`}>
      <p className="font-semibold">{message.title}</p>
      {safeJobId !== undefined && <p className="mt-1">Job #{safeJobId}</p>}
      <p className="mt-1">{message.description}</p>
      <p className="mt-2 text-red-700">{message.nextStep}</p>
    </div>
  );
}
