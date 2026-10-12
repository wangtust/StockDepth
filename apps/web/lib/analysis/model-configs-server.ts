import 'server-only';
import { readModelConfig, maskedModelKey } from '@/lib/security/model-key';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { llmModelConfigs } from '@/lib/db/schema';

export async function getActiveModelConfigs() {
  return db
    .select({
      id: llmModelConfigs.id,
      name: llmModelConfigs.name,
      provider: llmModelConfigs.provider,
      modelName: llmModelConfigs.modelName,
      isDefault: llmModelConfigs.isDefault,
      isActive: llmModelConfigs.isActive,
      updatedAt: llmModelConfigs.updatedAt
    })
    .from(llmModelConfigs)
    .where(and(eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt)))
    .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id));
}

export async function getModelConfigsForAdmin() {
  const configs = await db
    .select({
      id: llmModelConfigs.id,
      name: llmModelConfigs.name,
      provider: llmModelConfigs.provider,
      baseUrl: llmModelConfigs.baseUrl,
      apiKey: llmModelConfigs.apiKey,
      modelName: llmModelConfigs.modelName,
      inputPrice: llmModelConfigs.inputPrice,
      cachePrice: llmModelConfigs.cachePrice,
      outputPrice: llmModelConfigs.outputPrice,
      isDefault: llmModelConfigs.isDefault,
      isActive: llmModelConfigs.isActive,
      createdAt: llmModelConfigs.createdAt,
      updatedAt: llmModelConfigs.updatedAt
    })
    .from(llmModelConfigs)
    .where(isNull(llmModelConfigs.retiredAt))
    .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id));
  return configs.map(config => ({ ...config, apiKey: maskedModelKey(config.apiKey) }));
}

export async function getDefaultModelConfig() {
  const configs = await db
    .select()
    .from(llmModelConfigs)
    .where(and(eq(llmModelConfigs.isActive, true), isNull(llmModelConfigs.retiredAt)))
    .orderBy(desc(llmModelConfigs.isDefault), asc(llmModelConfigs.id))
    .limit(1);

  return configs[0] ? readModelConfig(configs[0]) : null;
}

export function maskApiKey(apiKey: string) {
  return maskedModelKey(apiKey);
}
