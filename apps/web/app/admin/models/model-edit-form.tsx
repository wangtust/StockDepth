'use client';

import { presentError } from '@/lib/analysis/error-presentation';

import { createContext, useContext, useRef, useState, useId, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { updateModelConfig } from '@/app/admin/actions';

const SaveState = createContext({ pending: false, success: '', error: '', feedbackId: '' });

export function ModelEditForm({ children }: { children: ReactNode }) {
  const submitting = useRef(false);
  const feedbackId = useId();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    submitting.current = true;
    setPending(true);
    setSuccess('');
    setError('');
    try {
      const result = await updateModelConfig(data);
      if (result.error) setError(presentError(result.error, 'request').description);
      else if (result.success) {
        setSuccess(`${String(data.get('name') || 'Model')} saved.`);
        const key = form.elements.namedItem('apiKey');
        if (key instanceof HTMLInputElement) key.value = '';
      } else setError('The save could not be confirmed. Please try again.');
    } catch {
      setError('Unable to save. Check your entries, connection, and sign-in status, then try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <SaveState.Provider value={{ pending, success, error, feedbackId }}>
      <form aria-busy={pending} aria-describedby={error ? feedbackId : undefined} onSubmit={submit} onInput={() => { setSuccess(''); setError(''); }} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">{children}</fieldset>
      </form>
    </SaveState.Provider>
  );
}

export function ModelSaveButton() {
  const { pending, success, error, feedbackId } = useContext(SaveState);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save Model'}</Button>
      <span id={feedbackId} role={error ? 'alert' : 'status'} aria-live="polite" className={`text-sm ${error ? 'text-red-700' : 'text-emerald-700'}`}>
        {pending ? 'Saving…' : error || success}
      </span>
    </div>
  );
}
