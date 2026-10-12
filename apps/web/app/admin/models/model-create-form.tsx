'use client';

import { useState, type ReactNode, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createModelConfig } from '@/app/admin/actions';

export function ModelCreateForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true); setError(''); setSuccess('');
    try {
      const result = await createModelConfig(data);
      if (result.error) setError(result.error);
      else {
        form.reset();
        setSuccess('模型调用测试成功，配置已保存。');
        router.refresh();
      }
    } catch {
      setError('创建失败，请检查必填字段和价格格式，或稍后重试。');
    } finally { setPending(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-slate-500">保存前会进行一次真实模型调用测试，可能产生少量 token 费用。测试成功后才会保存。</p>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
      {pending && <p role="status" className="text-sm text-slate-600">正在测试模型调用，请稍候…</p>}
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">{children}</fieldset>
    </form>
  );
}
