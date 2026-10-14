import { ModelCreateForm } from './model-create-form';
import { ModelConfigCard } from './model-config-card';
import { ModelActionsMenu } from './model-actions-menu';
import { ModelEditForm, ModelSaveButton } from './model-edit-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import {
  getModelConfigsForAdmin,
  maskApiKey
} from '@/lib/analysis/model-configs-server';
import { formatAdminDateTime, StatusBadge } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ saved?: string; created?: string }>;
};

export default async function AdminModelsPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const { saved, created } = await searchParams;
  const configs = await getModelConfigsForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Models</h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure the models, endpoints, and prices available to users. Expand a model to edit it.
        </p>
      </div>

      {(saved === '1' || created === '1') && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {created === '1' ? 'Model config created successfully.' : 'Model config saved successfully.'}
        </div>
      )}

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Add Model Config</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelConfigForm requireApiKey />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {configs.map((config) => (
          <div key={config.id} className="relative">
            <ModelActionsMenu configId={config.id} />
            <ModelConfigCard configId={config.id} summary={
              <span className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <span>
                  <span className="font-semibold">{config.name}</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    {config.provider} · {config.modelName} · {config.quickEnabled && 'Quick'}{config.quickEnabled && config.deepEnabled && ' / '}{config.deepEnabled && 'Deep'}
                  </span>
                </span>
                <span className="flex gap-2">
                  {config.isDefault && <StatusBadge status="default" />}
                  <StatusBadge status={config.isActive ? 'active' : 'disabled'} />
                </span>
              </span>
            }>
                <ModelConfigForm
                  config={{
                    ...config,
                    apiKeyLabel: maskApiKey(config.apiKey),
                    updatedAtLabel: formatAdminDateTime(config.updatedAt)
                  }}
                />
            </ModelConfigCard>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelConfigForm({
  config,
  requireApiKey = false
}: {
  config?: {
    id: number;
    name: string;
    provider: string;
    baseUrl: string;
    modelName: string;
    modelOptions: Record<string, string | number | boolean>;
    quickEnabled: boolean;
    deepEnabled: boolean;
    isDefault: boolean;
    isActive: boolean;
    inputPrice: string | null;
    cachePrice: string | null;
    outputPrice: string | null;
    apiKeyLabel: string;
    updatedAtLabel: string;
  };
  requireApiKey?: boolean;
}) {
  const isNewConfig = !config;

  const fields = (
    <>
      {config && <input type="hidden" name="configId" value={config.id} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Name" name="name" defaultValue={config?.name} required />
        <label className="block space-y-2 text-sm">
          <span>Provider</span>
          <select name="provider" defaultValue={config?.provider || 'qwen'} required className="w-full rounded-md border border-slate-200 px-3 py-2">
            {config && !['openai', 'openai-compatible', 'anthropic', 'google', 'azure', 'xai', 'deepseek', 'qwen', 'qwen-us', 'qwen-cn', 'glm', 'glm-cn', 'minimax', 'minimax-cn', 'openrouter', 'ollama'].includes(config.provider) && (
              <option value={config.provider} disabled>{config.provider} (unsupported; select another provider)</option>
            )}
            {['openai', 'openai-compatible', 'anthropic', 'google', 'azure', 'xai', 'deepseek', 'qwen', 'qwen-us', 'qwen-cn', 'glm', 'glm-cn', 'minimax', 'minimax-cn', 'openrouter', 'ollama'].map((provider) => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">For OpenAI-compatible endpoints, select openai-compatible and enter the provider name in Name.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="quickEnabled" defaultChecked={config?.quickEnabled ?? true} />Available for Quick</label><label className="flex items-center gap-2"><input type="checkbox" name="deepEnabled" defaultChecked={config?.deepEnabled ?? true} />Available for Deep</label></div>
        <Field
          label="Base URL"
          name="baseUrl"
          defaultValue={
            isNewConfig
              ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
              : config.baseUrl
          }
          placeholder="For example, https://tokenhub.tencentmaas.com/v1; omit /chat/completions"
        />
        <Field
          label={config ? `API Key (${config.apiKeyLabel})` : 'API Key'}
          name="apiKey"
          type="password"
          placeholder={config ? 'Leave blank to keep existing key' : ''}
          required={requireApiKey}
        />
        <Field label="Model name (API identifier)" name="modelName" defaultValue={config?.modelName} placeholder="For example, hy3 or glm-5.3" required />
        <label className="block space-y-2 text-sm lg:col-span-2"><span>Advanced model options (optional)</span><textarea name="modelOptions" defaultValue={JSON.stringify(Object.fromEntries(Object.entries(config?.modelOptions ?? {}).filter(([key]) => !['requests_per_minute', 'request_concurrency'].includes(key))), null, 2)} className="min-h-24 w-full rounded-md border border-slate-200 p-3 font-mono text-xs" placeholder={'For example, {"reasoning_effort":"high","max_tokens":4096}'} /><span className="block text-xs text-slate-500">Supported options: temperature, top_p, max_tokens, timeout, max_retries, reasoning_effort, thinking_level, effort, and seed. The system manages request frequency and concurrency automatically.</span></label>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-2 text-sm font-medium">Model pricing (CNY per million tokens)</legend>
        <p className="mb-3 text-xs text-slate-500">Fill in all prices or leave them all blank. Use 0 for free usage. Price changes do not affect previously recorded calls.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Input" name="inputPrice" type="number" defaultValue={config?.inputPrice ?? ''} />
          <Field label="Cache hit" name="cachePrice" type="number" defaultValue={config?.cachePrice ?? ''} />
          <Field label="Output" name="outputPrice" type="number" defaultValue={config?.outputPrice ?? ''} />
        </div>
      </fieldset>

      {config?.updatedAtLabel && (
        <p className="text-xs text-slate-500">Last updated {config.updatedAtLabel}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-sm text-slate-600">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="isDefault"
              defaultChecked={config?.isDefault ?? !config}
              className="h-4 w-4 rounded border-slate-300"
            />
            Default
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={config?.isActive ?? true}
              className="h-4 w-4 rounded border-slate-300"
            />
            Active
          </label>
        </div>
        {config ? <ModelSaveButton /> : <Button type="submit">Test and add model</Button>}
      </div>
    </>
  );
  return config ? <ModelEditForm>{fields}</ModelEditForm> : <ModelCreateForm>{fields}</ModelCreateForm>;
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  required
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <Input
        name={name}
        type={type}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? '0.000001' : undefined}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-2"
        required={required}
      />
    </label>
  );
}
