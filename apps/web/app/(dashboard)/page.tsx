import Link from 'next/link';
import type { ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  CandlestickChart,
  CheckCircle2,
  Clock3,
  FileText,
  Globe2,
  LineChart,
  Newspaper,
  ShieldCheck,
  Sparkles,
  WalletCards
} from 'lucide-react';

const agentFlow = [
  {
    name: 'Market Agent',
    status: 'reading price action',
    icon: CandlestickChart
  },
  {
    name: 'News Agent',
    status: 'checking catalysts',
    icon: Newspaper
  },
  {
    name: 'Risk Agent',
    status: 'stress testing exposure',
    icon: ShieldCheck
  },
  {
    name: 'Portfolio Agent',
    status: 'drafting allocation view',
    icon: WalletCards
  }
];

const reportSections = [
  'Trend and momentum',
  'Fundamental quality',
  'News and sentiment',
  'Position sizing notes',
  'Bull and bear debate',
  'Final decision memo'
];

const markets = [
  ['AAPL', '+1.84%', 'Buy zone forming'],
  ['PDD', '-0.62%', 'Margin pressure watched'],
  ['0700.HK', '+2.31%', 'China tech rebound'],
  ['002714.SZ', '+0.48%', 'Cycle data improving']
];

export default function HomePage() {
  return (
    <main className="bg-slate-950 text-white">
      <section className="relative min-h-[calc(100dvh-73px)] overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(20,184,166,0.22),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(59,130,246,0.18),transparent_30%),linear-gradient(135deg,#020617_0%,#0f172a_48%,#111827_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-slate-950 to-transparent" />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_520px] lg:px-8 lg:py-20">
          <div className="flex min-h-[520px] flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-sm text-emerald-100">
              <Sparkles className="h-4 w-4" />
              Multi-agent equity research workspace
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-normal text-white sm:text-6xl lg:text-7xl">
              StockDepth
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Turn tickers, market data, news, sentiment, fundamentals, and risk
              debate into structured investment reports that can be reviewed,
              saved, and billed by analysis run.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-md bg-emerald-400 px-6 text-base text-slate-950 hover:bg-emerald-300"
              >
                <Link href="/dashboard/analysis">
                  Start analysis
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-md border-white/20 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/pricing">View plans</Link>
              </Button>
            </div>
          </div>

          <div className="relative flex items-center">
            <div className="w-full border border-white/10 bg-slate-900/80 shadow-2xl shadow-black/35 backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-slate-400">
                    Live run
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">
                    NVDA · 2026-05-31
                  </h2>
                </div>
                <span className="border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-sm text-emerald-100">
                  running
                </span>
              </div>

              <div className="grid gap-3 p-5">
                {agentFlow.map((agent, index) => (
                  <div
                    key={agent.name}
                    className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center bg-slate-800 text-emerald-300">
                      <agent.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-white">{agent.name}</p>
                      <p className="text-sm text-slate-400">{agent.status}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="h-2 w-2 bg-emerald-300" />
                      {index === 3 ? 'finalizing' : 'done'}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/10 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-200">
                    <FileText className="h-5 w-5 text-sky-300" />
                    <span className="font-medium">Report sections</span>
                  </div>
                  <span className="text-sm text-slate-400">6 / 6</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {reportSections.map((section) => (
                    <div
                      key={section}
                      className="flex items-center gap-2 text-sm text-slate-300"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      {section}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16 text-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-3">
            <Feature
              icon={Bot}
              title="Agent debate, not one-shot text"
              body="Market, news, sentiment, fundamentals, trader, and risk roles produce separate views before the final portfolio memo."
            />
            <Feature
              icon={Globe2}
              title="US, Hong Kong, and A-share coverage"
              body="Use ticker-specific sources for global equities while keeping Chinese market coverage readable for A/HK names."
            />
            <Feature
              icon={Bell}
              title="Usage-based research lab"
              body="Accounts, pricing, and analysis credits are kept in StockDepth before calling the analysis engine."
            />
          </div>
        </div>
      </section>

      <section className="bg-slate-100 py-16 text-slate-950">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
              Research pipeline
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
              From ticker input to a decision-grade report
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The platform is designed around paid analysis runs: a user submits
              a ticker, StockDepth starts the analysis engine, and the web app stores
              the generated report for later review.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric icon={Clock3} label="Run tracking" value="Live status" />
            <Metric icon={LineChart} label="Market context" value="Price + trend" />
            <Metric icon={Newspaper} label="Catalyst scan" value="News + sentiment" />
            <Metric icon={BarChart3} label="Output" value="Saved memo" />
          </div>
        </div>
      </section>

      <section className="bg-white py-16 text-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Watchlist examples
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-normal">
                Built for repeatable equity research
              </h2>
            </div>
            <Button asChild variant="outline" className="hidden rounded-md sm:flex">
              <Link href="/sign-in">Open dashboard</Link>
            </Button>
          </div>
          <div className="overflow-hidden border border-slate-200">
            {markets.map(([ticker, move, note]) => (
              <div
                key={ticker}
                className="grid grid-cols-[110px_90px_1fr] gap-4 border-b border-slate-200 px-4 py-4 last:border-b-0 sm:px-6"
              >
                <span className="font-semibold text-slate-950">{ticker}</span>
                <span
                  className={
                    move.startsWith('+')
                      ? 'font-medium text-emerald-700'
                      : 'font-medium text-rose-700'
                  }
                >
                  {move}
                </span>
                <span className="text-slate-600">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Feature({
  icon: Icon,
  title,
  body
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex h-11 w-11 items-center justify-center bg-slate-950 text-emerald-300">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-normal">{title}</h2>
      <p className="mt-3 leading-7 text-slate-600">{body}</p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-slate-200 bg-white p-5">
      <Icon className="h-5 w-5 text-sky-600" />
      <p className="mt-5 text-sm uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
        {value}
      </p>
    </div>
  );
}
