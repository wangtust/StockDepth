import 'server-only';

import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { llmModelConfigs } from '@/lib/db/schema';

export async function getActiveModelConfigs() {
  return db
    .select({
      id: llmModelConfigs.id,
      name: llmModelConfigs.name,
      provider: llmModelConfigs.provider,
      baseUrl: llmModelConfigs.baseUrl,
      quickModel: llmModelConfigs.quickModel,
      deepModel: llmModelConfigs.deepModel,
      isDefault: llmModelConfigs.isDefault,
      isActive: llmModelConfigs.isActive,
      updatedAt: llmModelConfigs.updatedAt
    })
    .from(llmModelConfigs)
    .where(eq(llmModelConfigs.isActive, true))
    .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id));
}

export async function getModelConfigsForAdmin() {
  return db
    .select({
      id: llmModelConfigs.id,
      name: llmModelConfigs.name,
      provider: llmModelConfigs.provider,
      baseUrl: llmModelConfigs.baseUrl,
      apiKey: llmModelConfigs.apiKey,
      quickModel: llmModelConfigs.quickModel,
      deepModel: llmModelConfigs.deepModel,
      isDefault: llmModelConfigs.isDefault,
      isActive: llmModelConfigs.isActive,
      createdAt: llmModelConfigs.createdAt,
      updatedAt: llmModelConfigs.updatedAt
    })
    .from(llmModelConfigs)
    .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id));
}

export async function getDefaultModelConfig() {
  const configs = await db
    .select()
    .from(llmModelConfigs)
    .where(eq(llmModelConfigs.isActive, true))
    .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id))
    .limit(1);

  return configs[0] ?? null;
}

export function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return 'not set';
  }

  if (apiKey.length <= 10) {
    return 'configured';
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}
