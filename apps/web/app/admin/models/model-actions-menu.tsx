'use client';

import { presentError } from '@/lib/analysis/error-presentation';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { deleteModelConfig } from '@/app/admin/actions';

export function ModelActionsMenu({ configId }: { configId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const [success, setSuccess] = useState('');

  function removeModel() {
    if (submitting.current || !window.confirm('Deprecate this model configuration? It will no longer be available for new selections.')) return;
    submitting.current = true;
    setError(''); setSuccess('');
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set('configId', String(configId));
        const result = await deleteModelConfig(formData);
        if (result.error) setError(presentError(result.error, 'request').description);
        else { setSuccess('Model configuration deprecated.'); router.refresh(); }
      } catch {
        setError('Unable to delete the model. Please try again.');
      } finally { submitting.current = false; }
    });
  }

  return (
    <>
      <div className="absolute right-3 top-3 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild id={`model-menu-trigger-${configId}`} aria-controls={`model-menu-content-${configId}`}>
            <Button variant="ghost" size="icon" disabled={pending} aria-label="Model actions">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" id={`model-menu-content-${configId}`} aria-labelledby={`model-menu-trigger-${configId}`}>
            <DropdownMenuItem onSelect={removeModel} disabled={pending} className="text-red-600 focus:text-red-600">
              <Trash2 className="mr-2 h-4 w-4" />Delete model (deprecate)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {pending && <p role="status">Deprecating model…</p>}
      {success && <p role="status">{success}</p>}
      {error && <p role="alert" className="mb-2 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
    </>
  );
}
