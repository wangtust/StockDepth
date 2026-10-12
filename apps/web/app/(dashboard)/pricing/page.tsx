import { checkoutAction } from '@/lib/payments/actions';
import { Check, Coins } from 'lucide-react';
import { SubmitButton } from './submit-button';
import { CREDIT_PACKS } from '@/lib/payments/credit-packs';

export default function PricingPage() {
  return (
    <main className="bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
            <Coins className="h-4 w-4" />
            Usage-based credits
          </div>
          <h1 className="text-4xl font-semibold tracking-normal text-slate-950">
            Buy analysis credits
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            No monthly subscription. Purchase credits when you need them, then spend
            them on Shallow, Medium, or Deep analysis runs.
          </p>
          <p className="mt-2 text-sm font-medium text-slate-700">
            Larger packs include a better per-credit rate.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <PricingCard key={pack.id} {...pack} />
          ))}
        </div>
      </div>
    </main>
  );
}

function PricingCard({
  id,
  name,
  description,
  credits,
  amountUsd,
  discountLabel
}: {
  id: string;
  name: string;
  description: string;
  credits: number;
  amountUsd: number;
  discountLabel: string;
}) {
  const unitPrice = amountUsd / credits;
  const fullPrice = credits;
  const savings = fullPrice - amountUsd;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{name}</h2>
          <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
          {discountLabel}
        </span>
      </div>
      <p className="mt-6 text-4xl font-semibold text-slate-950">
        ${amountUsd}
        <span className="ml-2 text-base font-normal text-slate-500">
          one-time
        </span>
      </p>
      <p className="mt-2 text-sm text-slate-500">
        {credits} credits · ${unitPrice.toFixed(2)} per credit
      </p>
      <ul className="mt-6 space-y-3">
        <Feature>{credits} analysis credits</Feature>
        <Feature>Credits do not expire</Feature>
        <Feature>
          {savings > 0 ? `Save $${savings} vs single-credit pricing` : '$1 per credit'}
        </Feature>
      </ul>
      <form action={checkoutAction} className="mt-8">
        <input type="hidden" name="packId" value={id} />
        <SubmitButton />
      </form>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-slate-700">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      {children}
    </li>
  );
}
