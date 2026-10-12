import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import {
  getModelConfigsForAdmin,
  maskApiKey
} from '@/lib/analysis/model-configs-server';
import { createModelConfig, updateModelConfig } from '@/app/admin/actions';
import { formatAdminDateTime, StatusBadge } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ saved?: string; created?: string }>;
};

async function createModelConfigAction(formData: FormData) {
  'use server';
  await createModelConfig(formData);
  redirect('/admin/models?created=1');
}

async function updateModelConfigAction(formData: FormData) {
  'use server';
  await updateModelConfig(formData);
  redirect('/admin/models?saved=1');
}

export default async function AdminModelsPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const { saved, created } = await searchParams;
  const configs = await getModelConfigsForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Models</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage LLM gateways, API keys, and the default model used for new analysis jobs.
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
          <ModelConfigForm action={createModelConfigAction} requireApiKey />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {configs.map((config) => (
          <Card key={config.id} className="rounded-md">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{config.name}</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    {config.provider} · {config.quickModel} / {config.deepModel}
                  </p>
                </div>
                <div className="flex gap-2">
                  {config.isDefault && <StatusBadge status="default" />}
                  <StatusBadge status={config.isActive ? 'active' : 'disabled'} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ModelConfigForm
                action={updateModelConfigAction}
                config={{
                  ...config,
                  apiKeyLabel: maskApiKey(config.apiKey),
                  updatedAtLabel: formatAdminDateTime(config.updatedAt)
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ModelConfigForm({
  action,
  config,
  requireApiKey = false
}: {
  action: (formData: FormData) => Promise<void>;
  config?: {
    id: number;
    name: string;
    provider: string;
    baseUrl: string;
    quickModel: string;
    deepModel: string;
    isDefault: boolean;
    isActive: boolean;
    apiKeyLabel: string;
    updatedAtLabel: string;
  };
  requireApiKey?: boolean;
}) {
  const isNewConfig = !config;

  return (
    <form action={action} className="space-y-4">
      {config && <input type="hidden" name="configId" value={config.id} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Name" name="name" defaultValue={config?.name} required />
        <label className="block space-y-2 text-sm">
          <span>Provider</span>
          <select name="provider" defaultValue={config?.provider || 'qwen'} required className="w-full rounded-md border border-slate-200 px-3 py-2">
            {config && !['openai', 'openai-compatible', 'anthropic', 'google', 'azure', 'xai', 'deepseek', 'qwen', 'qwen-us', 'qwen-cn', 'glm', 'glm-cn', 'minimax', 'minimax-cn', 'openrouter', 'ollama'].includes(config.provider) && (
              <option value={config.provider} disabled>{config.provider}（不支持，请重新选择）</option>
            )}
            {['openai', 'openai-compatible', 'anthropic', 'google', 'azure', 'xai', 'deepseek', 'qwen', 'qwen-us', 'qwen-cn', 'glm', 'glm-cn', 'minimax', 'minimax-cn', 'openrouter', 'ollama'].map((provider) => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">腾讯等兼容接口的 Provider 请填写 openai-compatible；厂商名称填写在 Name 中。</p>
        <Field
          label="Base URL"
          name="baseUrl"
          defaultValue={
            isNewConfig
              ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
              : config.baseUrl
          }
          placeholder="例如 https://tokenhub.tencentmaas.com/v1；不要包含 /chat/completions"
        />
        <Field
          label={config ? `API Key (${config.apiKeyLabel})` : 'API Key'}
          name="apiKey"
          type="password"
          placeholder={config ? 'Leave blank to keep existing key' : ''}
          required={requireApiKey}
        />
        <Field label="Quick Model" name="quickModel" defaultValue={config?.quickModel || 'qwen-plus'} required />
        <Field label="Deep Model" name="deepModel" defaultValue={config?.deepModel || 'qwen-plus'} required />
      </div>

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
        <Button type="submit">{config ? 'Save Model' : 'Create Model'}</Button>
      </div>
    </form>
  );
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
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-2"
        required={required}
      />
    </label>
  );
}
