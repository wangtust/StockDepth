'use client';

import { presentError } from '@/lib/analysis/error-presentation';

import { useRef, useState, useId, type ReactNode, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createModelConfig } from '@/app/admin/actions';

export function ModelCreateForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const submitting = useRef(false);
  const feedbackId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true); setError(''); setSuccess('');
    try {
      const result = await createModelConfig(data);
      if (result.error) setError(presentError(result.error, 'request').description);
      else {
        form.reset();
        setSuccess('Model test succeeded. Configuration saved.');
        router.refresh();
      }
    } catch {
      setError('Unable to create the model. Refresh the page and try again. If the problem persists, check your connection and sign-in status.');
    } finally { submitting.current = false; setPending(false); }
  }
  return (
    <form aria-busy={pending} aria-describedby={error ? feedbackId : undefined} onSubmit={submit} className="space-y-4">
      <p className="text-xs text-slate-500">Adding a model makes a real test call that may incur a small token charge. The configuration is saved only if the test succeeds.</p>
      {error && <p id={feedbackId} role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
      {pending && <p role="status" className="text-sm text-slate-600">Testing the model. Please wait…</p>}
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">{children}</fieldset>
    </form>
  );
}
