import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  ChainModelConfig,
  HopAudit,
  ProviderKeySlot,
  SeedImage,
  UserVault,
  VaultProviderId,
} from '../src/types/mirofish.ts';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FailoverResult {
  text: string;
  modelUsed: string;
  providerUsed: VaultProviderId;
  keySlotUsed: string;
  hops: HopAudit[];
}

export const DEFAULT_CHAIN_CONFIG: ChainModelConfig[] = [
  {
    id: 'c_gemini_4',
    name: 'Gemini 4 Hydrogen',
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    enabled: true,
    timeoutMs: 35000,
    supportsVision: true,
  },
  {
    id: 'c_gemini_flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: true,
  },
  {
    id: 'c_claude_haiku',
    name: 'Claude Haiku 5.5',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    enabled: true,
    timeoutMs: 45000,
    supportsVision: true,
  },
  {
    id: 'c_groq_llama70',
    name: 'Groq Llama 3.3 70B',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    enabled: true,
    timeoutMs: 25000,
    supportsVision: false,
  },
  {
    id: 'c_grok_latest',
    name: 'xAI Grok 4.7',
    provider: 'grok',
    model: 'grok-4.7',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: false,
  },
  {
    id: 'c_or_free',
    name: 'OpenRouter Free Auto-Router',
    provider: 'openrouter',
    model: 'openrouter/free',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: true,
  },
  {
    id: 'c_or_llama70',
    name: 'OpenRouter Llama 3.3 70B (Free)',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: false,
  },
  {
    id: 'c_or_deepseek_v3',
    name: 'OpenRouter DeepSeek V3 (Free)',
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat-v3-0324:free',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: false,
  },
  {
    id: 'c_or_gemma3',
    name: 'OpenRouter Gemma 3 27B Vision (Free)',
    provider: 'openrouter',
    model: 'google/gemma-3-27b-it:free',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: true,
  },
  {
    id: 'c_cf_llama',
    name: 'Cloudflare Llama 3.3 70B',
    provider: 'cloudflare',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    enabled: true,
    timeoutMs: 30000,
    supportsVision: false,
  },
  {
    id: 'c_cf_qwq',
    name: 'Cloudflare QwQ 32B',
    provider: 'cloudflare',
    model: '@cf/qwen/qwq-32b',
    enabled: true,
    timeoutMs: 35000,
    supportsVision: false,
  },
];

export function supportsVisionModel(provider: VaultProviderId, model: string): boolean {
  const m = model.toLowerCase();
  if (provider === 'gemini' || provider === 'anthropic') return true;
  return /gemma-3|llama-4|mistral-small-3\.[12]|pixtral|vision|vl/.test(m);
}

const cooldowns = new Map<string, { until: number; reason: string }>();

function parseResetMs(header: string | null): number | null {
  if (!header) return null;
  const num = Number(header);
  if (Number.isFinite(num) && num > 0) return num * 1000;
  const match = header.match(/(?:(\d+)m)?(\d+(?:\.\d+)?)s/);
  if (match) {
    return (Number(match[1] || 0) * 60 + Number(match[2] || 0)) * 1000;
  }
  return null;
}

function shouldFailoverStatus(status: number): boolean {
  return [401, 402, 403, 408, 429, 500, 502, 503, 504].includes(status);
}

function collectProviderKeys(
  provider: VaultProviderId,
  slot?: ProviderKeySlot
): Array<{ keySlot: string; apiKey: string; accountId?: string }> {
  const out: Array<{ keySlot: string; apiKey: string; accountId?: string }> = [];
  if (slot) {
    const primaryAccId = slot.accountId?.trim();
    if (slot.primary?.trim()) {
      out.push({ keySlot: 'Primary', apiKey: slot.primary.trim(), accountId: primaryAccId });
    }
    (slot.backups || []).forEach((b, i) => {
      if (b?.trim()) {
        const backupAccId = slot.backupAccountIds?.[i]?.trim() || primaryAccId;
        out.push({ keySlot: `Backup ${i + 1}`, apiKey: b.trim(), accountId: backupAccId });
      }
    });
  }

  // Optional silent runtime fallback for Gemini if user has not entered a Gemini key in their vault yet
  if (out.length === 0 && provider === 'gemini' && process.env.GEMINI_API_KEY) {
    out.push({ keySlot: 'Runtime Fallback', apiKey: process.env.GEMINI_API_KEY });
  }

  // Filter Cloudflare entries lacking accountId
  if (provider === 'cloudflare') {
    return out.filter((item) => Boolean(item.accountId));
  }
  return out;
}

export interface PooledHopTarget {
  poolId: string;
  entry: ChainModelConfig;
  keySlot: string;
  apiKey: string;
  accountId?: string;
}

export function expandVaultPool(
  vault: UserVault | null | undefined,
  preferredModel?: string,
  preferredProvider?: VaultProviderId
): PooledHopTarget[] {
  const baseChain = vault?.chain?.length ? vault.chain : DEFAULT_CHAIN_CONFIG;
  const enabled = baseChain.filter((c) => c.enabled);

  let ordered = enabled;
  if (preferredModel && preferredModel !== 'freeflow') {
    ordered = [
      ...enabled.filter((e) => e.model === preferredModel),
      ...enabled.filter((e) => e.model !== preferredModel),
    ];
  } else if (preferredProvider) {
    ordered = [
      ...enabled.filter((e) => e.provider === preferredProvider),
      ...enabled.filter((e) => e.provider !== preferredProvider),
    ];
  }

  const expanded: PooledHopTarget[] = [];
  for (const entry of ordered) {
    const slot = vault?.providers?.[entry.provider];
    const keys = collectProviderKeys(entry.provider, slot);
    for (const k of keys) {
      expanded.push({
        poolId: `${entry.id}::${k.keySlot}`,
        entry,
        keySlot: k.keySlot,
        apiKey: k.apiKey,
        accountId: k.accountId,
      });
    }
  }
  return expanded;
}

async function callAnthropicAdapter(params: {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  images?: SeedImage[];
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; status: number }> {
  const system = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const conversation = params.messages.filter((m) => m.role !== 'system');
  const normalizedConv =
    conversation.length > 0 ? conversation : [{ role: 'user' as const, content: 'Continue.' }];
  const lastUserIdx = normalizedConv.map((m) => m.role).lastIndexOf('user');
  const images = params.images || [];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(params.timeoutMs || 45000),
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.15,
      ...(system ? { system } : {}),
      messages: normalizedConv.map((m, i) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content:
          i === lastUserIdx && images.length > 0
            ? [
                ...images.map((img) => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: img.mimeType,
                    data: img.base64Data,
                  },
                })),
                { type: 'text', text: m.content },
              ]
            : m.content,
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`), {
      status: res.status,
      retryAfter: parseResetMs(res.headers.get('retry-after')),
    });
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
  if (!text) {
    throw Object.assign(new Error('Empty Anthropic payload'), { status: 502 });
  }
  return { text, status: res.status };
}

async function callGeminiAdapter(params: {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  images?: SeedImage[];
  responseSchema?: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
  maxTokens?: number;
}): Promise<{ text: string; status: number }> {
  const ai = new GoogleGenAI({
    apiKey: params.apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const nonSystem = params.messages.filter((m) => m.role !== 'system');
  const safeTurns = nonSystem.length > 0 ? nonSystem : [{ role: 'user' as const, content: 'Continue.' }];
  const lastUserIdx = safeTurns.map((m) => m.role).lastIndexOf('user');
  const images = params.images || [];

  // Preserve multi-turn history byte-for-byte using Gemini contents parts format
  const contents = safeTurns.map((m, i) => {
    const parts: Array<Record<string, unknown>> = [];
    if (i === lastUserIdx && images.length > 0) {
      for (const img of images) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64Data,
          },
        });
      }
    }
    parts.push({ text: m.content });
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  const config: Record<string, unknown> = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (params.model.startsWith('gemini-4') && params.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: params.thinkingLevel };
  }
  if (params.responseSchema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = params.responseSchema;
  }
  if (params.maxTokens) {
    config.maxOutputTokens = params.maxTokens;
  }

  const res = await ai.models.generateContent({
    model: params.model,
    contents,
    config,
  });

  const text = (res.text ?? '').trim();
  if (!text) {
    throw Object.assign(new Error('Empty Gemini payload'), { status: 502 });
  }
  return { text, status: 200 };
}

async function callOpenAiCompatibleAdapter(params: {
  provider: 'groq' | 'grok' | 'openrouter' | 'cloudflare';
  apiKey: string;
  accountId?: string;
  model: string;
  messages: ChatMsg[];
  images?: SeedImage[];
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; status: number }> {
  let url = '';
  if (params.provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
  } else if (params.provider === 'grok') {
    url = 'https://api.x.ai/v1/chat/completions';
  } else if (params.provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
  } else {
    if (!params.accountId?.trim()) {
      throw Object.assign(new Error('Cloudflare Account ID required'), { status: 400 });
    }
    url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(params.accountId.trim())}/ai/v1/chat/completions`;
  }

  const images = params.images || [];
  const lastUserIdx = params.messages.map((m) => m.role).lastIndexOf('user');
  const wireMessages =
    images.length > 0
      ? params.messages.map((m, i) =>
          i === lastUserIdx
            ? {
                role: m.role,
                content: [
                  { type: 'text', text: m.content },
                  ...images.map((img) => ({
                    type: 'image_url',
                    image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` },
                  })),
                ],
              }
            : m
        )
      : params.messages;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${params.apiKey}`,
  };
  if (params.provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'https://mirofish.app';
    headers['X-Title'] = 'MiroFish';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(params.timeoutMs || 30000),
    body: JSON.stringify({
      model: params.model,
      messages: wireMessages,
      stream: false,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`), {
      status: res.status,
      retryAfter:
        parseResetMs(res.headers.get('retry-after')) ??
        parseResetMs(res.headers.get('x-ratelimit-reset-requests')),
    });
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    result?: { response?: string };
  } | null;

  const text =
    data?.choices?.[0]?.message?.content?.trim() ??
    data?.result?.response?.trim() ??
    '';
  if (!text) {
    throw Object.assign(new Error('Empty or malformed OpenAI-compatible payload'), { status: 502 });
  }
  return { text, status: res.status };
}

export async function runChainCompletion(params: {
  vault?: UserVault | null;
  messages: ChatMsg[];
  images?: SeedImage[];
  preferredModel?: string;
  preferredProvider?: VaultProviderId;
  responseSchema?: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  maxTokens?: number;
}): Promise<FailoverResult> {
  const images = params.images || [];
  const hops: HopAudit[] = [];
  const pool = expandVaultPool(params.vault, params.preferredModel, params.preferredProvider);

  const filteredPool =
    images.length > 0
      ? pool.filter((item) => item.entry.supportsVision ?? supportsVisionModel(item.entry.provider, item.entry.model))
      : pool;

  if (filteredPool.length === 0) {
    throw Object.assign(
      new Error(
        images.length > 0
          ? 'No vision-capable provider keys are configured in your Vault. Open Proxy Vault to add a Gemini or Claude key.'
          : 'No provider keys configured for the enabled chain. Open Proxy Vault to add at least one API key.'
      ),
      { statusCode: 400 }
    );
  }

  for (const target of filteredPool) {
    const cd = cooldowns.get(target.poolId);
    if (cd && cd.until > Date.now()) {
      hops.push({
        provider: target.entry.provider,
        model: target.entry.model,
        keySlot: target.keySlot,
        latencyMs: 0,
        status: 429,
        ok: false,
        error: `Cooling down (${Math.ceil((cd.until - Date.now()) / 1000)}s)`,
      });
      continue;
    }

    const t0 = Date.now();
    try {
      let result: { text: string; status: number };
      if (target.entry.provider === 'gemini') {
        result = await callGeminiAdapter({
          apiKey: target.apiKey,
          model: target.entry.model,
          messages: params.messages,
          images,
          responseSchema: params.responseSchema,
          thinkingLevel: params.thinkingLevel,
          maxTokens: params.maxTokens,
        });
      } else if (target.entry.provider === 'anthropic') {
        result = await callAnthropicAdapter({
          apiKey: target.apiKey,
          model: target.entry.model,
          messages: params.messages,
          images,
          timeoutMs: target.entry.timeoutMs,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
        });
      } else {
        result = await callOpenAiCompatibleAdapter({
          provider: target.entry.provider,
          apiKey: target.apiKey,
          accountId: target.accountId,
          model: target.entry.model,
          messages: params.messages,
          images,
          timeoutMs: target.entry.timeoutMs,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
        });
      }

      hops.push({
        provider: target.entry.provider,
        model: target.entry.model,
        keySlot: target.keySlot,
        latencyMs: Date.now() - t0,
        status: result.status,
        ok: true,
      });

      return {
        text: result.text,
        modelUsed: target.entry.model,
        providerUsed: target.entry.provider,
        keySlotUsed: target.keySlot,
        hops,
      };
    } catch (err: unknown) {
      const e = err as { status?: number; statusCode?: number; message?: string; retryAfter?: number; name?: string };
      const status = e.name === 'TimeoutError' || e.name === 'AbortError' ? 408 : (e.status ?? e.statusCode ?? 502);
      const errMsg = (e.message || 'Upstream failure').slice(0, 140);

      if (status === 429 || /rate.?limit|quota|resource_exhausted/i.test(errMsg)) {
        const ms = Math.max(e.retryAfter ?? 45_000, 5_000);
        cooldowns.set(target.poolId, { until: Date.now() + ms, reason: `HTTP ${status}` });
      }

      hops.push({
        provider: target.entry.provider,
        model: target.entry.model,
        keySlot: target.keySlot,
        latencyMs: Date.now() - t0,
        status,
        ok: false,
        error: errMsg,
      });

      if (!shouldFailoverStatus(status) && status !== 502) {
        // Still continue through failover chain for resilience
        continue;
      }
    }
  }

  throw Object.assign(
    new Error(
      `All pooled provider keys failed: ${hops.map((h) => `${h.provider}/${h.model} (${h.keySlot}): ${h.error}`).join(' | ')}`
    ),
    { statusCode: 503, hops }
  );
}

export async function testProviderConnection(params: {
  provider: VaultProviderId;
  apiKey: string;
  accountId?: string;
  model?: string;
}): Promise<{ ok: boolean; latencyMs: number; status: number; message: string }> {
  const t0 = Date.now();
  const pingMsgs: ChatMsg[] = [{ role: 'user', content: 'Reply with OK' }];
  try {
    if (params.provider === 'gemini') {
      const modelsToTry = params.model
        ? [params.model]
        : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-4-hydrogen'];
      let lastErr: unknown;
      for (const m of modelsToTry) {
        try {
          await callGeminiAdapter({
            apiKey: params.apiKey,
            model: m,
            messages: pingMsgs,
            maxTokens: 16,
          });
          return { ok: true, latencyMs: Date.now() - t0, status: 200, message: `Connected (${m})` };
        } catch (e) {
          lastErr = e;
          const msg = (e as Error)?.message || '';
          if (!/404|not found|unsupported/i.test(msg)) throw e;
        }
      }
      throw lastErr;
    }

    if (params.provider === 'anthropic') {
      const modelsToTry = params.model
        ? [params.model]
        : ['claude-haiku-5-5', 'claude-3-5-haiku-latest'];
      let lastErr: unknown;
      for (const m of modelsToTry) {
        try {
          await callAnthropicAdapter({
            apiKey: params.apiKey,
            model: m,
            messages: pingMsgs,
            timeoutMs: 15000,
            maxTokens: 4,
          });
          return { ok: true, latencyMs: Date.now() - t0, status: 200, message: `Connected (${m})` };
        } catch (e) {
          lastErr = e;
          const status = (e as { status?: number })?.status;
          if (status !== 404) throw e;
        }
      }
      throw lastErr;
    }

    if (params.provider === 'cloudflare' && !params.accountId?.trim()) {
      return { ok: false, latencyMs: 0, status: 400, message: 'Cloudflare Account ID required' };
    }

    const defaultModels: Record<'groq' | 'grok' | 'openrouter' | 'cloudflare', string[]> = {
      groq: ['llama-3.3-70b-versatile'],
      grok: ['grok-4.7', 'grok-4', 'grok-3-latest'],
      openrouter: ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free'],
      cloudflare: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'],
    };

    const modelsToTry = params.model ? [params.model] : defaultModels[params.provider];
    let lastErr: unknown;
    for (const m of modelsToTry) {
      try {
        await callOpenAiCompatibleAdapter({
          provider: params.provider,
          apiKey: params.apiKey,
          accountId: params.accountId,
          model: m,
          messages: pingMsgs,
          timeoutMs: 15000,
          maxTokens: 16,
        });
        return { ok: true, latencyMs: Date.now() - t0, status: 200, message: `Connected (${m})` };
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number })?.status;
        if (status !== 404 && status !== 400) throw e;
      }
    }
    throw lastErr;
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      status: e.status || 400,
      message: (e.message || 'Connection failed').slice(0, 140),
    };
  }
}
