'use client';

import { Suspense, useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Copy, Gift, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { User } from '@/lib/db/schema';
import { safeJson } from '@/lib/http/safe-json';
import { RecentlyDeletedJobs } from '@/components/recently-deleted-jobs';

type AccountCredits = {
  analysisCredits?: number | null;
} | null;

type PublicUser = Omit<User, 'passwordHash'> & {
  inviteCode?: string | null;
};

const fetcher = (url: string) => fetch(url).then(safeJson);

function CreditBalanceSkeleton() {
  return (
    <Card className="mb-8 h-[140px]">
      <CardHeader>
        <CardTitle>Credit Balance</CardTitle>
      </CardHeader>
    </Card>
  );
}

function CreditBalance() {
  const { data: account } = useSWR<AccountCredits>('/api/account', fetcher);

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WalletCards className="h-5 w-5 text-emerald-600" />
          Credit Balance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-2xl font-semibold text-slate-950">
                {account?.analysisCredits ?? 0} credits
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Credits are yours only and are consumed when you start analysis runs.
              </p>
            </div>
            <Button asChild variant="outline" className="rounded-md">
              <Link href="/pricing">Buy Credits</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InviteCodeSkeleton() {
  return (
    <Card className="h-[220px]">
      <CardHeader>
        <CardTitle>Invite Code</CardTitle>
      </CardHeader>
    </Card>
  );
}

function InviteCodeCard() {
  const { data: user } = useSWR<PublicUser>('/api/user', fetcher);
  const [copied, setCopied] = useState(false);
  const inviteCode = user?.inviteCode || '';
  const inviteUrl = useMemo(() => {
    if (!inviteCode || typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/sign-up?inviteCode=${inviteCode}`;
  }, [inviteCode]);

  async function copyInviteCode() {
    const value = inviteUrl || inviteCode;
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-orange-600" />
          Invite Code
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-h-14 flex-1 items-center rounded-md border border-slate-200 bg-slate-50 px-4 font-mono text-3xl font-semibold tracking-[0.24em] text-slate-950">
                {inviteCode || '------'}
              </div>
              <Button
                type="button"
                className="rounded-md"
                variant="outline"
                disabled={!inviteCode}
                onClick={copyInviteCode}
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Share this six-letter code with a new user. When they sign up with
              it, you receive 5 bonus credits.
            </p>
          </div>

          {inviteUrl && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              {inviteUrl}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="mb-6 text-lg font-medium text-slate-950 lg:text-2xl">
        Account
      </h1>
      <Suspense fallback={<CreditBalanceSkeleton />}>
        <CreditBalance />
      </Suspense>
      <Suspense fallback={<InviteCodeSkeleton />}>
        <InviteCodeCard />
      </Suspense>
      <RecentlyDeletedJobs />
    </section>
  );
}
