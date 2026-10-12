'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type DeletedJob = { id: number; ticker: string; tradeDate: string; status: string; hiddenAt: string };

async function fetcher(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法加载最近删除的任务');
  return data as { jobs: DeletedJob[] };
}

export function RecentlyDeletedJobs() {
  const { data, error, isLoading, mutate } = useSWR('/api/analysis/jobs/deleted', fetcher, { refreshInterval: 10000 });
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  async function restore(id: number) {
    setRestoringId(id);
    setActionError('');
    setNotice('');
    try {
      const response = await fetch(`/api/analysis/jobs/${id}/restore`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '恢复失败');
      await mutate();
      setNotice('已恢复，可在 Analysis 的 Jobs 列表查看。');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>最近删除</CardTitle>
        <p className="text-sm text-muted-foreground">显示最近删除的 50 条任务。恢复保留原任务状态和报告，不会重新执行分析。</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(error || actionError) && <p role="alert" className="text-sm text-red-600">{actionError || error.message}</p>}
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
        {!isLoading && !error && data?.jobs.length === 0 && <p className="text-sm text-muted-foreground">暂无已删除任务。</p>}
        {data?.jobs.map(job => (
          <div key={job.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{job.ticker} · {job.tradeDate} · {job.status}</p>
              <p className="text-xs text-muted-foreground">删除时间：{new Date(job.hiddenAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
            </div>
            <Button variant="outline" size="sm" disabled={restoringId !== null} onClick={() => restore(job.id)}>
              {restoringId === job.id ? '恢复中…' : '恢复'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
