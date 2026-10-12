import { ensureInstrument } from '@/lib/market/catalogue';
import { getJobsPage } from '@/lib/analysis/jobs-page';
import { RequestTiming } from '@/lib/http/request-timing';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import {
  llmModelConfigs,
  analysisJobs,
  creditTransactions,
  users
} from '@/lib/db/schema';
import { getDepthCreditCostFromDb } from '@/lib/analysis/pricing-server';
import { normalizeTicker } from '@/lib/market/tickers';

const createJobSchema = z.object({
  ticker: z.string().trim().min(1).max(40),
  tradeDate: z.string().trim().min(8).max(20).optional(),
  realtimeData: z.coerce.boolean().default(false),
  language: z.string().trim().min(1).max(40).default('Chinese'),
  depth: z.coerce.number().int().refine((value) => [1, 3, 5].includes(value)),
  analysts: z.array(z.string()).min(1).default(['market', 'news', 'fundamentals']),
  modelConfigId: z.number().int().positive()
});

function today() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function GET(request: NextRequest) {
  const timing = new RequestTiming();
  const currentUser = await timing.measure('auth', () => getCurrentUserFromSession());
  if (currentUser instanceof NextResponse) return currentUser;
  const raw = request.nextUrl.searchParams.get('before');
  const before = raw === null ? undefined : Number(raw);
  if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  }
  const payload = await timing.measure('jobs', () => getJobsPage(currentUser.id, before));
  return NextResponse.json(payload, { headers: { ...timing.headers(), 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUserFromSession();
  if (currentUser instanceof NextResponse) {
    return currentUser;
  }

  const parsed = createJobSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const ticker = normalizeTicker(data.ticker);
  const tradeDate = data.tradeDate || today();
  const creditCost = await getDepthCreditCostFromDb(data.depth);
  const [modelConfig] = await db.select().from(llmModelConfigs)
    .where(and(eq(llmModelConfigs.id, data.modelConfigId), eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt))).limit(1);

  if (!modelConfig) {
    return NextResponse.json(
      { error: '所选模型不可用，请选择其他已启用模型。' },
      { status: 400 }
    );
  }

  const job = await db.transaction(async (tx) => {
    const [updatedUser] = await tx
      .update(users)
      .set({
        analysisCredits: sql`${users.analysisCredits} - ${creditCost}`,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(users.id, currentUser.id),
          gte(users.analysisCredits, creditCost)
        )
      )
      .returning({ analysisCredits: users.analysisCredits });

    if (!updatedUser) {
      return null;
    }

    const instrument = await ensureInstrument(ticker, tx);
    const [createdJob] = await tx
      .insert(analysisJobs)
      .values({
        runId: `saas-job-${randomUUID()}`,
        userId: currentUser.id,
        ticker,
        instrumentId: instrument.id,
        tradeDate,
        realtimeData: data.realtimeData,
        language: data.language,
        depth: data.depth,
        analysts: JSON.stringify(data.analysts),
        provider: modelConfig.provider,
        baseUrl: modelConfig.baseUrl,
        quickModel: modelConfig.modelName,
        deepModel: modelConfig.modelName,
        modelConfigId: modelConfig.id,
        status: 'queued'
      })
      .returning();

    await tx.insert(creditTransactions).values({
      userId: currentUser.id,
      jobId: createdJob.id,
      amount: -creditCost,
      reason: 'analysis_job_created'
    });

    return {
      ...createdJob,
      creditCost,
      remainingCredits: updatedUser.analysisCredits
    };
  });

  if (!job) {
    return NextResponse.json(
      { error: `Not enough analysis credits. This depth costs ${creditCost} credits.` },
      { status: 402 }
    );
  }

  return NextResponse.json({ job }, { status: 201 });
}

async function getCurrentUserFromSession() {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return currentUser;
}
