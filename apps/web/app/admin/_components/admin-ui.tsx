import { cn } from '@/lib/utils';

const statusStyles: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  queued: 'border-amber-200 bg-amber-50 text-amber-800',
  failed: 'border-red-200 bg-red-50 text-red-700',
  disabled: 'border-slate-200 bg-slate-100 text-slate-600',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600',
  admin: 'border-purple-200 bg-purple-50 text-purple-700',
  super_admin: 'border-purple-300 bg-purple-100 text-purple-800',
  default: 'border-blue-200 bg-blue-50 text-blue-700',
  member: 'border-slate-200 bg-slate-50 text-slate-700',
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  offline: 'border-red-200 bg-red-50 text-red-700'
};

export function StatusBadge({
  status,
  className
}: {
  status?: string | null;
  className?: string;
}) {
  const value = status || 'unknown';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
        statusStyles[value] || 'border-slate-200 bg-slate-50 text-slate-700',
        className
      )}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}

export function formatAdminDate(value?: Date | null) {
  if (!value) {
    return 'not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value);
}

export function formatAdminDateTime(value?: Date | null) {
  if (!value) {
    return 'not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value);
}

export function formatElapsed(start?: Date | null, end: Date = new Date()) {
  if (!start) {
    return 'not started';
  }

  const totalSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
