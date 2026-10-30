import { lockBillingAccounts, mutateCredits } from '@/lib/credits/ledger';
import { ModelSelectionError, pinModelVersions } from '@/lib/analysis/model-versions';
import { analysisDateSchema } from '@/lib/analysis/date-validation';
import { publicAnalysisJob } from '@/lib/analysis/public-job';
import { ensureInstrument } from '@/lib/market/catalogue';
import { getJobsPage } from '@/lib/analysis/jobs-page';
import { RequestTiming } from '@/lib/http/request-timing';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import {
  llmModelConfigs,
  analysisJobs,
} from '@/lib/db/schema';
import { getDepthCreditCostFromDb } from '@/lib/analysis/pricing-server';
import { normalizeTicker } from '@/lib/market/tickers';

const createJobSchema = z.object({
  ticker: z.string().trim().min(1).max(40),
  tradeDate: analysisDateSchema.optional(),
  realtimeData: z.coerce.boolean().default(false),
  language: z.string().trim().min(1).max(40).default('English'),
  depth: z.coerce.number().int().refine((value) => [1, 3, 5].includes(value)),
  analysts: z.array(z.string()).min(1).default(['market', 'news', 'fundamentals']),
  modelConfigId: z.number().int().positive().optional(),
  quickModelConfigId: z.number().int().positive().optional(),
  deepModelConfigId: z.number().int().positive().optional()
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
  try { return await enqueueJob(request); }
  catch (error) {
    if (error instanceof ModelSelectionError) return NextResponse.json({error:error.message},{status:400});
    throw error;
  }
}

async function enqueueJob(request: NextRequest) {
  const currentUser = await getCurrentUserFromSession();
  if (currentUser instanceof NextResponse) {
    return currentUser;
  }

  const parsed = createJobSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const ticker = normalizeTicker(data.ticker);
  const tradeDate = data.tradeDate || today();
  const creditCost = await getDepthCreditCostFromDb(data.depth);
  const quickId = data.quickModelConfigId ?? data.modelConfigId;
  const deepId = data.deepModelConfigId ?? data.modelConfigId;
  if (!quickId || !deepId) return NextResponse.json({ error: 'Select both Quick and Deep models.' }, { status: 400 });
  const [quickConfig] = await db.select().from(llmModelConfigs)
    .where(and(eq(llmModelConfigs.id, quickId), eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt), isNull(llmModelConfigs.unavailableReason), eq(llmModelConfigs.quickEnabled, true))).limit(1);
  const [deepConfig] = await db.select().from(llmModelConfigs)
    .where(and(eq(llmModelConfigs.id, deepId), eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt), isNull(llmModelConfigs.unavailableReason), eq(llmModelConfigs.deepEnabled, true))).limit(1);

  if (!quickConfig || !deepConfig) {
    return NextResponse.json(
      { error: 'The selected model is unavailable. Select another active model.' },
      { status: 400 }
    );
  }
  const job = await db.transaction(async (tx) => {
    const [account] = await lockBillingAccounts(tx,[currentUser.id]);
    if (!account || account.analysisCredits < creditCost) return null;
    const pinned = await pinModelVersions(tx,quickConfig,deepConfig);

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
        ...pinned,
        chargedCredits: creditCost,
        status: 'queued'
      })
      .returning();

    const charged = await mutateCredits(tx,{userId:currentUser.id,jobId:createdJob.id,amount:-creditCost,
      reason:'analysis_job_created',operationKey:`analysis-charge:${createdJob.id}`});

    return {
      ...createdJob,
      creditCost,
      remainingCredits: charged.balance
    };
  });

  if (!job) {
    return NextResponse.json(
      { error: `Not enough analysis credits. This depth costs ${creditCost} credits.` },
      { status: 402 }
    );
  }

  return NextResponse.json({ job: publicAnalysisJob(job) }, { status: 201 });
}

async function getCurrentUserFromSession() {
  const currentUser = await getUser();
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return currentUser;
}
