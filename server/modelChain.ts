import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ModelHop, ProviderChainSlot, SeedImage } from '../src/types/mirofish.ts';

export type ProviderId = 'gemini' | 'anthropic' | 'groq' | 'openrouter' | 'cloudflare' | 'custom';

export interface ChainEntry {
  id: string;
  provider: ProviderId;
  model: string;
  role: 'specialist-reviewer' | 'primary-swarm' | 'failover-free';
  supportsVision: boolean;
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FailoverResult {
  text: string;
  modelUsed: string;
  providerUsed: ProviderId;
  hops: ModelHop[];
}

export const DEFAULT_CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

// Ordered failover chain mirroring Prdictor-op's multi-provider model placement:
// 1) Native Gemini 4 Hydrogen (free/default AI Studio multimodal engine)
// 2) Groq Llama 3.3 70B Versatile (ultra-fast free tier if GROQ_API_KEY set)
// 3) OpenRouter free frontier pool (if OPENROUTER_API_KEY set)
// 4) Cloudflare Workers AI (if CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN set)
// 5) Gemini 3.1 Flash Lite (secondary Gemini fallback)
// 6) Custom upstream proxy (if PREDICTOR_PROXY_URL set)
// Plus Anthropic Claude Haiku 5.5 (specialist picture extractor & final independent reviewer when ANTHROPIC_API_KEY is set).
export const MODEL_CHAIN: ChainEntry[] = [
  {
    id: 'c_gemini_4',
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    role: 'primary-swarm',
    supportsVision: true,
  },
  {
    id: 'c_groq_llama70',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_or_llama70',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_or_deepseek_v3',
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat-v3-0324:free',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_or_deepseek_r1',
    provider: 'openrouter',
    model: 'deepseek/deepseek-r1:free',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_or_gemma3',
    provider: 'openrouter',
    model: 'google/gemma-3-27b-it:free',
    role: 'failover-free',
    supportsVision: true,
  },
  {
    id: 'c_or_mistral',
    provider: 'openrouter',
    model: 'mistralai/mistral-small-3.2-24b-instruct:free',
    role: 'failover-free',
    supportsVision: true,
  },
  {
    id: 'c_or_qwen3',
    provider: 'openrouter',
    model: 'qwen/qwen3-235b-a22b:free',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_cf_llama',
    provider: 'cloudflare',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_cf_qwq',
    provider: 'cloudflare',
    model: '@cf/qwen/qwq-32b',
    role: 'failover-free',
    supportsVision: false,
  },
  {
    id: 'c_gemini_lite',
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    role: 'failover-free',
    supportsVision: true,
  },
  {
    id: 'c_custom',
    provider: 'custom',
    model: process.env.PREDICTOR_PROXY_MODEL || 'custom-proxy',
    role: 'failover-free',
    supportsVision: false,
  },
];

// Rate-limit cooldown registry (prevents hammering exhausted keys/models)
const cooldowns = new Map<string, { until: number; reason: string }>();

function getKeysForProvider(provider: ProviderId): string[] {
  const split = (val: string | undefined) =>
    (val || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  switch (provider) {
    case 'gemini':
      return split(process.env.GEMINI_API_KEY);
    case 'anthropic':
      return split(process.env.ANTHROPIC_API_KEY);
    case 'groq':
      return split(process.env.GROQ_API_KEY);
    case 'openrouter':
      return split(process.env.OPENROUTER_API_KEY);
    case 'cloudflare':
      return process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN
        ? split(process.env.CLOUDFLARE_API_TOKEN)
        : [];
    case 'custom':
      return process.env.PREDICTOR_PROXY_URL ? [process.env.PREDICTOR_PROXY_KEY || 'open'] : [];
  }
}

export function isProviderConfigured(provider: ProviderId): boolean {
  return getKeysForProvider(provider).length > 0;
}

export function getChainSnapshot(): ProviderChainSlot[] {
  const slots: ProviderChainSlot[] = [];
  if (isProviderConfigured('anthropic')) {
    slots.push({
      id: 'c_anthropic_reviewer',
      provider: 'anthropic',
      model: DEFAULT_CLAUDE_MODEL,
      role: 'Specialist Vision & Final Review',
      configured: true,
      supportsVision: true,
      coolingDownSeconds: getCooldownRemaining('c_anthropic_reviewer#1'),
    });
  } else {
    slots.push({
      id: 'c_anthropic_reviewer',
      provider: 'anthropic',
      model: DEFAULT_CLAUDE_MODEL,
      role: 'Specialist Vision & Final Review (Optional Secret)',
      configured: false,
      supportsVision: true,
      coolingDownSeconds: 0,
    });
  }

  for (const entry of MODEL_CHAIN) {
    slots.push({
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      role: entry.role === 'primary-swarm' ? 'Primary Swarm Engine' : 'Failover Chain',
      configured: isProviderConfigured(entry.provider),
      supportsVision: entry.supportsVision,
      coolingDownSeconds: getCooldownRemaining(`${entry.id}#1`),
    });
  }
  return slots;
}

function getCooldownRemaining(poolId: string): number {
  const cd = cooldowns.get(poolId);
  if (!cd || cd.until <= Date.now()) return 0;
  return Math.ceil((cd.until - Date.now()) / 1000);
}

function setCooldown(poolId: string, ms: number, reason: string): void {
  cooldowns.set(poolId, { until: Date.now() + ms, reason });
}

function parseResetMs(header: string | null): number | null {
  if (!header) return null;
  const num = Number(header);
  if (Number.isFinite(num) && num > 0) return num * 1000;
  const match = header.match(/(?:(\d+)m)?(\d+(?:\.\d+)?)s/);
  if (match) {
    return ((Number(match[1] || 0) * 60) + Number(match[2] || 0)) * 1000;
  }
  return null;
}

function isRateLimit(status: number, body: string): boolean {
  return status === 429 || /rate.?limit|quota|too many requests|resource_exhausted/i.test(body);
}

export async function callClaudeDirect(params: {
  messages: ChatMsg[];
  images?: SeedImage[];
  model?: string;
}): Promise<{ text: string; model: string }> {
  const keys = getKeysForProvider('anthropic');
  if (keys.length === 0) {
    throw Object.assign(
      new Error('ANTHROPIC_API_KEY is not configured in server secrets.'),
      { statusCode: 400 }
    );
  }
  const model = params.model || DEFAULT_CLAUDE_MODEL;
  const system = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const conversation = params.messages.filter((m) => m.role !== 'system');
  const lastUserIdx = conversation.map((m) => m.role).lastIndexOf('user');
  const images = params.images || [];

  let lastErr: Error | null = null;
  for (const key of keys) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          temperature: 0.1,
          system,
          messages: conversation.map((m, i) => ({
            role: m.role,
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

      if (!response.ok) {
        const body = await response.text();
        throw Object.assign(
          new Error(`Claude HTTP ${response.status}: ${body.slice(0, 180)}`),
          { statusCode: response.status }
        );
      }
      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
        stop_reason?: string;
      };
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim();
      if (!text) throw new Error('Claude returned no analysis.');
      return { text, model };
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr || new Error('Claude request failed.');
}

async function callGeminiSdk(params: {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  images?: SeedImage[];
  responseSchema?: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
}): Promise<string> {
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

  const userTranscript = params.messages
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'assistant' ? `Assistant: ${m.content}` : m.content))
    .join('\n\n');

  const parts: Array<Record<string, unknown>> = [];
  for (const img of params.images || []) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Data,
      },
    });
  }
  parts.push({ text: userTranscript });

  const config: Record<string, unknown> = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (params.model.startsWith('gemini-4') && params.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: params.thinkingLevel };
  }
  if (params.responseSchema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = params.responseSchema;
  }

  const res = await ai.models.generateContent({
    model: params.model,
    contents: { parts },
    config,
  });

  const text = (res.text ?? '').trim();
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

async function callOpenAiCompatibleProvider(params: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: ChatMsg[];
  images?: SeedImage[];
}): Promise<string> {
  let url = '';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (params.provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers['authorization'] = `Bearer ${params.apiKey}`;
  } else if (params.provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers['authorization'] = `Bearer ${params.apiKey}`;
  } else if (params.provider === 'cloudflare') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    headers['authorization'] = `Bearer ${params.apiKey}`;
  } else if (params.provider === 'custom') {
    url = process.env.PREDICTOR_PROXY_URL || '';
    if (process.env.PREDICTOR_PROXY_KEY) {
      headers['authorization'] = `Bearer ${process.env.PREDICTOR_PROXY_KEY}`;
    }
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

  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(35_000),
    body: JSON.stringify({
      model: params.model,
      messages: wireMessages,
      stream: false,
      temperature: 0.15,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const err = Object.assign(new Error(`HTTP ${response.status}: ${body.slice(0, 140)}`), {
      status: response.status,
      retryAfter: parseResetMs(response.headers.get('retry-after')) ??
        parseResetMs(response.headers.get('x-ratelimit-reset-requests')),
      rawBody: body,
    });
    throw err;
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    text?: string;
    output?: string;
  };
  const content = data.choices?.[0]?.message?.content ?? data.text ?? data.output ?? '';
  if (!content.trim()) throw new Error('Empty provider completion');
  return content.trim();
}

/**
 * Execute a chat completion across the expanded backup-key failover chain.
 * Mirrors Prdictor-op's pool.ts + engine.ts + hub.ts failover & cooldown mechanics.
 */
export async function runChainCompletion(params: {
  messages: ChatMsg[];
  images?: SeedImage[];
  preferredModel?: string;
  preferredProvider?: ProviderId;
  responseSchema?: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
}): Promise<FailoverResult> {
  const images = params.images || [];
  const hops: ModelHop[] = [];

  // Build expanded pool: each configured entry is paired with primary + backup keys
  const expanded: Array<{ poolId: string; entry: ChainEntry; key: string }> = [];

  // Optional explicit preference (e.g., preferredModel or preferredProvider) goes first
  const orderedChain = params.preferredModel && params.preferredModel !== 'freeflow'
    ? [
        ...MODEL_CHAIN.filter((e) => e.model === params.preferredModel),
        ...MODEL_CHAIN.filter((e) => e.model !== params.preferredModel),
      ]
    : params.preferredProvider
      ? [
          ...MODEL_CHAIN.filter((e) => e.provider === params.preferredProvider),
          ...MODEL_CHAIN.filter((e) => e.provider !== params.preferredProvider),
        ]
      : MODEL_CHAIN;

  for (const entry of orderedChain) {
    if (images.length > 0 && !entry.supportsVision) continue;
    const keys = getKeysForProvider(entry.provider);
    keys.forEach((key, idx) => {
      expanded.push({
        poolId: `${entry.id}#${idx + 1}`,
        entry,
        key,
      });
    });
  }

  if (expanded.length === 0) {
    throw Object.assign(
      new Error('No configured provider keys available for this request. Set GEMINI_API_KEY (or another provider key) in Settings > Secrets.'),
      { statusCode: 400 }
    );
  }

  const unavailableKeys = new Set<string>();

  for (const item of expanded) {
    if (unavailableKeys.has(item.poolId)) continue;
    const cd = cooldowns.get(item.poolId);
    if (cd && cd.until > Date.now()) {
      hops.push({
        model: item.entry.model,
        provider: item.entry.provider,
        ok: false,
        detail: `cooling down (${Math.ceil((cd.until - Date.now()) / 1000)}s)`,
        latencyMs: 0,
      });
      continue;
    }

    const t0 = Date.now();
    try {
      let text = '';
      if (item.entry.provider === 'gemini') {
        text = await callGeminiSdk({
          apiKey: item.key,
          model: item.entry.model,
          messages: params.messages,
          images,
          responseSchema: params.responseSchema,
          thinkingLevel: params.thinkingLevel,
        });
      } else {
        text = await callOpenAiCompatibleProvider({
          provider: item.entry.provider,
          model: item.entry.model,
          apiKey: item.key,
          messages: params.messages,
          images,
        });
      }

      hops.push({
        model: item.entry.model,
        provider: item.entry.provider,
        ok: true,
        detail: 'served',
        latencyMs: Date.now() - t0,
      });
      return {
        text,
        modelUsed: item.entry.model,
        providerUsed: item.entry.provider,
        hops,
      };
    } catch (err: unknown) {
      const e = err as { status?: number; statusCode?: number; message?: string; retryAfter?: number; rawBody?: string };
      const status = e.status ?? e.statusCode ?? 0;
      const bodyStr = e.rawBody || e.message || 'error';

      if (isRateLimit(status, bodyStr)) {
        const ms = Math.max(e.retryAfter ?? 45_000, 5_000);
        setCooldown(item.poolId, ms, `HTTP ${status}`);
        // Skip sibling models sharing the same exhausted provider+key
        for (const sib of expanded) {
          if (sib.entry.provider === item.entry.provider && sib.key === item.key) {
            unavailableKeys.add(sib.poolId);
          }
        }
        hops.push({
          model: item.entry.model,
          provider: item.entry.provider,
          ok: false,
          detail: `rate-limited (${Math.round(ms / 1000)}s cooldown)`,
          latencyMs: Date.now() - t0,
        });
      } else {
        hops.push({
          model: item.entry.model,
          provider: item.entry.provider,
          ok: false,
          detail: (e.message || 'failed').slice(0, 120),
          latencyMs: Date.now() - t0,
        });
      }
    }
  }

  throw Object.assign(
    new Error(`All configured models in the failover chain failed: ${hops.map((h) => `${h.model}: ${h.detail}`).join(' | ')}`),
    { statusCode: 502 }
  );
}
