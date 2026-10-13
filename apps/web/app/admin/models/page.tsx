import { ModelCreateForm } from './model-create-form';
import { ModelConfigCard } from './model-config-card';
import { ModelActionsMenu } from './model-actions-menu';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/auth/admin';
import {
  getModelConfigsForAdmin,
  maskApiKey
} from '@/lib/analysis/model-configs-server';
import { updateModelConfig } from '@/app/admin/actions';
import { formatAdminDateTime, StatusBadge } from '@/app/admin/_components/admin-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ saved?: string; created?: string }>;
};

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
          配置可供用户选择的模型、接口和价格。点击列表展开编辑。
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
                  action={updateModelConfigAction}
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
  action,
  config,
  requireApiKey = false
}: {
  action?: (formData: FormData) => Promise<void>;
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
              <option value={config.provider} disabled>{config.provider}（不支持，请重新选择）</option>
            )}
            {['openai', 'openai-compatible', 'anthropic', 'google', 'azure', 'xai', 'deepseek', 'qwen', 'qwen-us', 'qwen-cn', 'glm', 'glm-cn', 'minimax', 'minimax-cn', 'openrouter', 'ollama'].map((provider) => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">腾讯等兼容接口的 Provider 请填写 openai-compatible；厂商名称填写在 Name 中。</p>
        <div className="flex gap-6 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="quickEnabled" defaultChecked={config?.quickEnabled ?? true} />可用于 Quick</label><label className="flex items-center gap-2"><input type="checkbox" name="deepEnabled" defaultChecked={config?.deepEnabled ?? true} />可用于 Deep</label></div>
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
        <Field label="模型名称（API 使用的标识）" name="modelName" defaultValue={config?.modelName} placeholder="例如 hy3、glm-5.3" required />
        <label className="block space-y-2 text-sm lg:col-span-2"><span>模型能力与限流参数（JSON，可选）</span><textarea name="modelOptions" defaultValue={JSON.stringify(config?.modelOptions ?? {}, null, 2)} className="min-h-24 w-full rounded-md border border-slate-200 p-3 font-mono text-xs" placeholder={'例如 {"reasoning_effort":"high","max_tokens":4096,"requests_per_minute":30,"request_concurrency":2}'} /><span className="block text-xs text-slate-500">支持 temperature、top_p、max_tokens、timeout、max_retries、reasoning_effort、thinking_level、effort、seed、requests_per_minute、request_concurrency。</span></label>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-2 text-sm font-medium">模型价格（人民币元 / 百万 tokens）</legend>
        <p className="mb-3 text-xs text-slate-500">全部填写或全部留空；0 表示免费。修改价格不会影响已记录调用。</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="输入" name="inputPrice" type="number" defaultValue={config?.inputPrice ?? ''} />
          <Field label="缓存命中" name="cachePrice" type="number" defaultValue={config?.cachePrice ?? ''} />
          <Field label="输出" name="outputPrice" type="number" defaultValue={config?.outputPrice ?? ''} />
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
        <Button type="submit">{config ? 'Save Model' : '测试并添加模型'}</Button>
      </div>
    </>
  );
  return config ? <form action={action} className="space-y-4">{fields}</form> : <ModelCreateForm>{fields}</ModelCreateForm>;
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
