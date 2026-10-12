import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { analysisWorkerSettings } from '@/lib/db/schema';

export const ANALYSIS_WORKER_SETTINGS_KEY = 'analysis_worker';

export type AnalysisConcurrencySettings = {
  key: string;
  systemConcurrency: number;
  userConcurrency: number;
  updatedAt: Date | null;
};

export type AnalysisConcurrencySettingsInput = {
  systemConcurrency: number;
  userConcurrency: number;
};

const DEFAULT_ANALYSIS_CONCURRENCY_SETTINGS: AnalysisConcurrencySettingsInput = {
  systemConcurrency: 200,
  userConcurrency: 5
};

function coercePositiveInteger(value: unknown, fallback: number) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 1
    ? Math.floor(numericValue)
    : fallback;
}

export function getAnalysisConcurrencyDefaults(): AnalysisConcurrencySettingsInput {
  return DEFAULT_ANALYSIS_CONCURRENCY_SETTINGS;
}

export function normalizeAnalysisConcurrencySettings(
  settings: Partial<AnalysisConcurrencySettingsInput & { key?: string; updatedAt?: Date | string | null }>
): AnalysisConcurrencySettings {
  const defaults = getAnalysisConcurrencyDefaults();

  return {
    key: settings.key || ANALYSIS_WORKER_SETTINGS_KEY,
    systemConcurrency: coercePositiveInteger(settings.systemConcurrency, defaults.systemConcurrency),
    userConcurrency: coercePositiveInteger(settings.userConcurrency, defaults.userConcurrency),
    updatedAt: settings.updatedAt ? new Date(settings.updatedAt) : null
  };
}

export async function ensureAnalysisConcurrencySettings() {
  const defaults = getAnalysisConcurrencyDefaults();

  await db
    .insert(analysisWorkerSettings)
    .values({
      key: ANALYSIS_WORKER_SETTINGS_KEY,
      systemConcurrency: defaults.systemConcurrency,
      userConcurrency: defaults.userConcurrency
    })
    .onConflictDoNothing();
}

export async function getAnalysisConcurrencySettings() {
  try {
    await ensureAnalysisConcurrencySettings();

    const [row] = await db
      .select({
        key: analysisWorkerSettings.key,
        systemConcurrency: analysisWorkerSettings.systemConcurrency,
        userConcurrency: analysisWorkerSettings.userConcurrency,
        updatedAt: analysisWorkerSettings.updatedAt
      })
      .from(analysisWorkerSettings)
      .where(eq(analysisWorkerSettings.key, ANALYSIS_WORKER_SETTINGS_KEY))
      .limit(1);

    return normalizeAnalysisConcurrencySettings(row ?? {});
  } catch {
    return normalizeAnalysisConcurrencySettings({});
  }
}

export async function upsertAnalysisConcurrencySettings(
  input: AnalysisConcurrencySettingsInput
) {
  const settings = normalizeAnalysisConcurrencySettings(input);

  const [row] = await db
    .insert(analysisWorkerSettings)
    .values({
      key: ANALYSIS_WORKER_SETTINGS_KEY,
      systemConcurrency: settings.systemConcurrency,
      userConcurrency: settings.userConcurrency,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: analysisWorkerSettings.key,
      set: {
        systemConcurrency: settings.systemConcurrency,
        userConcurrency: settings.userConcurrency,
        updatedAt: new Date()
      }
    })
    .returning({
      key: analysisWorkerSettings.key,
      systemConcurrency: analysisWorkerSettings.systemConcurrency,
      userConcurrency: analysisWorkerSettings.userConcurrency,
      updatedAt: analysisWorkerSettings.updatedAt
    });

  return normalizeAnalysisConcurrencySettings(row ?? settings);
}
