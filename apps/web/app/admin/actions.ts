'use server';

import { modelConfigWrite, encryptModelKey } from '@/lib/security/model-key';

import { isAnalysisRunner } from '@/lib/analysis/runner-process';
import { testModelConnection } from '@/lib/analysis/test-model-server';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePlatformAdmin, requireSuperAdmin, writeAdminAuditLog } from '@/lib/auth/admin';
import {
  upsertAnalysisConcurrencySettings
} from '@/lib/analysis/concurrency-settings';
import { db } from '@/lib/db/drizzle';
import {
  adminAuditLogs,
  analysisPricing,
  analysisJobs,
  creditTransactions,
  llmModelConfigs,
  users
} from '@/lib/db/schema';
import { getDepthLabel } from '@/lib/analysis/pricing';

const userIdSchema = z.coerce.number().int().positive();
const concurrencySettingsSchema = z.object({
  systemConcurrency: z.coerce.number().int().min(1).max(1000),
  userConcurrency: z.coerce.number().int().min(1).max(1000)
});

function revalidateAdmin() {
  revalidatePath('/admin');
  revalidatePath('/admin/users');
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/jobs');
  revalidatePath('/admin/pricing');
  revalidatePath('/admin/models');
  revalidatePath('/admin/system');
}

const modelPrice = z.preprocess(value => value === '' || value == null ? null : value,
  z.string().trim().regex(/^\d{1,9}(\.\d{1,6})?$/, '价格须为非负数字，最多六位小数').nullable());
const priceFields = ['inputPrice', 'cachePrice', 'outputPrice'] as const;
function modelPrices(formData: FormData) {
  return Object.fromEntries(priceFields.map(field => [field, formData.get(field)]));
}
function validateModelPrices(data: Record<string, unknown>) {
  const values = priceFields.map(field => data[field]);
  if (values.some(value => value != null) && !values.every(value => value != null)) throw new Error('输入、缓存命中、输出价格须全部填写，或全部留空。');
  if (values.every(value => value != null) && Number(values[1]) > Number(values[0])) throw new Error('缓存命中价格不能高于普通输入价格。');
}

const modelConfigSchema = z.object({
  inputPrice: modelPrice,
  cachePrice: modelPrice,
  outputPrice: modelPrice,
  name: z.string().trim().min(1).max(120),
  provider: z.enum(['openai', 'openai-compatible', 'anthropic', 'google', 'azure', 'xai', 'deepseek', 'qwen', 'qwen-us', 'qwen-cn', 'glm', 'glm-cn', 'minimax', 'minimax-cn', 'openrouter', 'ollama']),
  baseUrl: z.string().trim().max(500),
  apiKey: z.string().trim().max(1000).optional(),
  modelName: z.string().trim().min(1).max(160),
  modelOptions: z.preprocess(value => {
    if (typeof value !== 'string' || !value.trim()) return {};
    try { return JSON.parse(value); } catch { return value; }
  }, z.record(z.union([z.string().max(100), z.number().finite(), z.boolean()]))
    .refine(options => Object.keys(options).every(key => ['temperature','top_p','max_tokens','max_retries','timeout','reasoning_effort','thinking_level','effort','seed','requests_per_minute','request_concurrency'].includes(key)), '包含不支持的模型参数')
    .refine(options => ['requests_per_minute','request_concurrency'].every(key => options[key] == null || (typeof options[key] === 'number' && options[key] > 0 && options[key] <= 10000)), '限流参数须为 1 到 10000 的数字')),
  quickEnabled: z.coerce.boolean().optional(),
  deepEnabled: z.coerce.boolean().optional(),
  isDefault: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional()
});

async function clearOtherDefaultModelConfigs(configId?: number) {
  const query = db
    .update(llmModelConfigs)
    .set({ isDefault: false, updatedAt: new Date() });

  if (configId) {
    await query.where(sql`${llmModelConfigs.id} <> ${configId}`);
    return;
  }

  await query;
}

export async function createModelConfig(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = modelConfigSchema
    .extend({ apiKey: z.string().trim().min(1).max(1000) })
    .safeParse({
      ...modelPrices(formData),
      name: formData.get('name'),
      provider: formData.get('provider'),
      baseUrl: formData.get('baseUrl'),
      apiKey: formData.get('apiKey'),
      modelName: formData.get('modelName'),
      modelOptions: formData.get('modelOptions'),
      quickEnabled: formData.get('quickEnabled') === 'on',
      deepEnabled: formData.get('deepEnabled') === 'on',
      isDefault: formData.get('isDefault') === 'on',
      isActive: formData.get('isActive') === 'on'
    });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const labels: Record<string, string> = { name: '显示名称', provider: 'Provider', baseUrl: 'Base URL', apiKey: 'API Key', modelName: '模型名称', inputPrice: '输入价格', cachePrice: '缓存命中价格', outputPrice: '输出价格' };
    const field = String(issue.path[0] || '表单');
    const detail = field.endsWith('Price') ? '须为非负数字，最多六位小数；也可留空。' : field === 'provider' ? '请选择受支持的供应商。' : '请检查是否为空或超过长度限制。';
    return { error: `${labels[field] || field}：${detail}` };
  }
  const data = parsed.data;
  try { validateModelPrices(data); }
  catch (error) { return { error: (error as Error).message }; }
  let storedData: typeof data;
  try { storedData = modelConfigWrite(data); }
  catch { return { error: '模型密钥加密配置不可用，配置未保存。' }; }
  const probe = await testModelConnection(data);
  if (!probe.success) return { error: probe.error || '模型测试失败，配置未保存。' };
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(llmModelConfigs).values(storedData).returning();
      if (data.isDefault) {
        await tx.update(llmModelConfigs).set({ isDefault: false, updatedAt: new Date() })
          .where(sql`${llmModelConfigs.id} <> ${created.id}`);
      }
      await tx.insert(adminAuditLogs).values({
        adminUserId: admin.id,
        action: 'llm_model_config.create',
        targetType: 'llm_model_config',
        targetId: created.id,
        metadata: JSON.stringify({
          name: created.name, provider: created.provider, baseUrl: created.baseUrl,
          prices: Object.fromEntries(priceFields.map(field => [field, created[field]])),
          modelName: created.modelName, modelOptions: created.modelOptions, quickEnabled: created.quickEnabled, deepEnabled: created.deepEnabled, isDefault: created.isDefault, isActive: created.isActive
        })
      });
    });
  } catch (error) {
    const code = (error as { code?: string }).code || 'unknown';
    console.error('Model config persistence failed; database error code:', code);
    return { error: '模型测试通过，但数据库保存失败，请稍后重试或联系管理员检查数据库。' };
  }
  revalidateAdmin();
  return { success: 'Model config created.' };
}

export async function updateModelConfig(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const configId = userIdSchema.parse(formData.get('configId'));
  const data = modelConfigSchema.parse({
    ...modelPrices(formData),
    name: formData.get('name'),
    provider: formData.get('provider'),
    baseUrl: formData.get('baseUrl'),
    apiKey: formData.get('apiKey') || undefined,
    modelName: formData.get('modelName'),
    modelOptions: formData.get('modelOptions'),
    quickEnabled: formData.get('quickEnabled') === 'on',
    deepEnabled: formData.get('deepEnabled') === 'on',
    isDefault: formData.get('isDefault') === 'on',
    isActive: formData.get('isActive') === 'on'
  });

  validateModelPrices(data);
  let storedApiKey: string | undefined;
  try { storedApiKey = data.apiKey ? encryptModelKey(data.apiKey) : undefined; }
  catch { return { error: '模型密钥加密配置不可用，配置未保存。' }; }
  const updateValues = {
    inputPrice: data.inputPrice,
    cachePrice: data.cachePrice,
    outputPrice: data.outputPrice,

    name: data.name,
    provider: data.provider,
    baseUrl: data.baseUrl,
    modelName: data.modelName,
    modelOptions: data.modelOptions,
    quickEnabled: !!data.quickEnabled,
    deepEnabled: !!data.deepEnabled,
    isDefault: !!data.isDefault,
    isActive: !!data.isActive,
    updatedAt: new Date(),
    ...(storedApiKey ? { apiKey: storedApiKey } : {})
  };

  const [updated] = await db
    .update(llmModelConfigs)
    .set(updateValues)
    .where(and(eq(llmModelConfigs.id, configId), isNull(llmModelConfigs.retiredAt)))
    .returning();

  if (!updated) {
    return { error: 'Model config not found.' };
  }

  if (updated.isDefault) {
    await clearOtherDefaultModelConfigs(updated.id);
  }

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'llm_model_config.update',
    targetType: 'llm_model_config',
    targetId: updated.id,
    metadata: {
      name: updated.name,
      provider: updated.provider,
      baseUrl: updated.baseUrl,
      prices: Object.fromEntries(priceFields.map(field => [field, updated[field]])),
      modelName: updated.modelName,
      modelOptions: updated.modelOptions,
      quickEnabled: updated.quickEnabled,
      deepEnabled: updated.deepEnabled,
      isDefault: updated.isDefault,
      isActive: updated.isActive,
      apiKeyChanged: !!data.apiKey
    }
  });

  revalidateAdmin();
  return { success: 'Model config updated.' };
}

export async function deleteModelConfig(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const configId = userIdSchema.parse(formData.get('configId'));
  const result = await db.transaction(async (tx) => {
    const [model] = await tx.select({ id: llmModelConfigs.id })
      .from(llmModelConfigs).where(eq(llmModelConfigs.id, configId)).for('update');
    if (!model) return { error: '模型已不存在，请刷新页面。' };
    const [activeJob] = await tx.select({ id: analysisJobs.id }).from(analysisJobs)
      .where(and(or(eq(analysisJobs.modelConfigId, configId), eq(analysisJobs.quickModelConfigId, configId), eq(analysisJobs.deepModelConfigId, configId)), inArray(analysisJobs.status, ['queued', 'running'])))
      .limit(1);
    if (activeJob) return { error: '该模型仍有排队或运行中的任务，请任务结束后再删除。' };
    await tx.update(llmModelConfigs)
      .set({ retiredAt: new Date(), isActive: false, isDefault: false, updatedAt: new Date() })
      .where(eq(llmModelConfigs.id, configId));
    return { success: '模型已弃用，配置保留在数据库中。' };
  });
  if (result.error) return result;
  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'llm_model_config.retire',
    targetType: 'llm_model_config',
    targetId: configId,
    metadata: {}
  });
  revalidateAdmin();
  revalidatePath('/dashboard/analysis');
  return result;
}

export async function updateAnalysisPricing(formData: FormData) {
  const admin = await requirePlatformAdmin();

  const prices = [
    {
      depth: 1,
      label: getDepthLabel(1),
      creditCost: z.coerce.number().int().min(1).max(1000).parse(formData.get('depth1'))
    },
    {
      depth: 3,
      label: getDepthLabel(3),
      creditCost: z.coerce.number().int().min(1).max(1000).parse(formData.get('depth3'))
    },
    {
      depth: 5,
      label: getDepthLabel(5),
      creditCost: z.coerce.number().int().min(1).max(1000).parse(formData.get('depth5'))
    }
  ];

  for (const price of prices) {
    await db
      .insert(analysisPricing)
      .values({ ...price, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: analysisPricing.depth,
        set: {
          label: price.label,
          creditCost: price.creditCost,
          updatedAt: new Date()
        }
      });
  }

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'analysis_pricing.update',
    targetType: 'analysis_pricing',
    metadata: {
      prices: Object.fromEntries(prices.map((price) => [price.depth, price.creditCost]))
    }
  });

  revalidateAdmin();
  return { success: 'Analysis pricing updated.' };
}

export async function updateAnalysisConcurrencySettings(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const settings = concurrencySettingsSchema.parse({
    systemConcurrency: formData.get('systemConcurrency'),
    userConcurrency: formData.get('userConcurrency')
  });

  const updated = await upsertAnalysisConcurrencySettings(settings);

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'analysis_worker_settings.update',
    targetType: 'analysis_worker_settings',
    metadata: {
      systemConcurrency: updated.systemConcurrency,
      userConcurrency: updated.userConcurrency
    }
  });

  revalidateAdmin();
  return { success: 'Analysis concurrency settings updated.' };
}

export async function setUserStatus(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const userId = userIdSchema.parse(formData.get('userId'));
  const status = z.enum(['active', 'disabled']).parse(formData.get('status'));

  if (userId === admin.id) {
    return { error: 'You cannot change your own account status.' };
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return { error: 'User not found.' };
  }

  if (target.role === 'super_admin' && admin.role !== 'super_admin') {
    return { error: 'Only a super admin can change another super admin.' };
  }

  await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'user.status.update',
    targetType: 'user',
    targetId: userId,
    metadata: { from: target.status, to: status }
  });

  revalidateAdmin();
  return { success: 'User status updated.' };
}

export async function setUserRole(formData: FormData) {
  const admin = await requireSuperAdmin();
  const userId = userIdSchema.parse(formData.get('userId'));
  const role = z.enum(['member', 'admin', 'super_admin']).parse(formData.get('role'));

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return { error: 'User not found.' };
  }

  if (target.role === 'super_admin' && role !== 'super_admin') {
    const superAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'super_admin'), eq(users.status, 'active')));

    if (superAdmins.length <= 1) {
      return { error: 'At least one active super admin is required.' };
    }
  }

  await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'user.role.update',
    targetType: 'user',
    targetId: userId,
    metadata: { from: target.role, to: role }
  });

  revalidateAdmin();
  return { success: 'User role updated.' };
}

export async function adjustUserCredits(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const targetUserId = userIdSchema.parse(formData.get('userId'));
  const amount = z.coerce.number().int().min(-100000).max(100000).parse(formData.get('amount'));
  const note = z.string().trim().max(200).optional().parse(formData.get('note') || undefined);

  const [updatedUser] = await db
    .update(users)
    .set({
      analysisCredits: sql<number>`greatest(0, ${users.analysisCredits} + ${amount})`,
      updatedAt: new Date()
    })
    .where(eq(users.id, targetUserId))
    .returning({
      id: users.id,
      analysisCredits: users.analysisCredits
    });

  if (!updatedUser) {
    return { error: 'User not found.' };
  }

  await db.insert(creditTransactions).values({
    userId: targetUserId,
    amount,
    reason: 'admin_credit_adjustment'
  });

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'user.credits.adjust',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { amount, note, resultingCredits: updatedUser.analysisCredits }
  });

  revalidateAdmin();
  return { success: 'Credits updated.' };
}

export async function retryAnalysisJob(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const jobId = userIdSchema.parse(formData.get('jobId'));

  const [job] = await db
    .update(analysisJobs)
    .set({
      status: 'queued',
      workerOwner: null, workerLeaseUntil: null,
      externalStatus: 'admin-retry-queued',
      externalPid: null,
      errorMessage: null,
      completedAt: null,
      updatedAt: new Date()
    })
    .where(and(eq(analysisJobs.id, jobId), eq(analysisJobs.status, 'failed')))
    .returning();

  if (!job) {
    return { error: 'Only failed jobs can be retried.' };
  }

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'analysis_job.retry',
    targetType: 'analysis_job',
    targetId: jobId,
    metadata: { ticker: job.ticker, userId: job.userId }
  });

  revalidateAdmin();
  return { success: 'Job queued for retry.' };
}

export async function cancelAnalysisJob(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const jobId = userIdSchema.parse(formData.get('jobId'));

  const [existingJob] = await db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.id, jobId))
    .limit(1);

  if (!existingJob || !['queued', 'running'].includes(existingJob.status)) {
    return { error: 'Only queued or running jobs can be cancelled.' };
  }

  let killed = false;
  if (existingJob.externalPid && await isAnalysisRunner(existingJob.externalPid, existingJob.runId)) {
    try {
      process.kill(existingJob.externalPid, 'SIGTERM');
      killed = true;
    } catch {
      killed = false;
    }
  }

  const [job] = await db
    .update(analysisJobs)
    .set({
      status: 'failed',
      workerOwner: null, workerLeaseUntil: null,
      externalStatus: 'cancelled',
      errorMessage: `Cancelled by admin user #${admin.id}`,
      completedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(analysisJobs.id, jobId))
    .returning();

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: 'analysis_job.cancel',
    targetType: 'analysis_job',
    targetId: jobId,
    metadata: {
      ticker: job.ticker,
      previousStatus: existingJob.status,
      externalPid: existingJob.externalPid,
      killed
    }
  });

  revalidateAdmin();
  return { success: 'Job cancelled.' };
}
