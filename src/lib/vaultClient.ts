import type { ChainModelConfig, ProviderKeySlot, UserVault, VaultProviderId } from '../types/mirofish';

const VAULT_STORAGE_KEY = 'mirofish_user_vault_v1';

export const DEFAULT_CHAIN: ChainModelConfig[] = [
  { id: 'c_gemini_4', name: 'Gemini 4 Hydrogen', provider: 'gemini', model: 'gemini-4-hydrogen', enabled: true, timeoutMs: 35000, supportsVision: true },
  { id: 'c_claude_haiku', name: 'Claude Haiku 5.5', provider: 'anthropic', model: 'claude-haiku-5-5', enabled: true, timeoutMs: 45000, supportsVision: true },
  { id: 'c_groq_llama70', name: 'Groq Llama 3.3 70B', provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: true, timeoutMs: 25000, supportsVision: false },
  { id: 'c_or_llama70', name: 'OpenRouter Llama 3.3 70B (Free)', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', enabled: true, timeoutMs: 30000, supportsVision: false },
  { id: 'c_or_deepseek_v3', name: 'OpenRouter DeepSeek V3 (Free)', provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324:free', enabled: true, timeoutMs: 30000, supportsVision: false },
  { id: 'c_or_deepseek_r1', name: 'OpenRouter DeepSeek R1 (Free)', provider: 'openrouter', model: 'deepseek/deepseek-r1:free', enabled: true, timeoutMs: 35000, supportsVision: false },
  { id: 'c_or_gemma3', name: 'OpenRouter Gemma 3 27B Vision (Free)', provider: 'openrouter', model: 'google/gemma-3-27b-it:free', enabled: true, timeoutMs: 30000, supportsVision: true },
  { id: 'c_or_mistral', name: 'OpenRouter Mistral Small 3.2 (Free)', provider: 'openrouter', model: 'mistralai/mistral-small-3.2-24b-instruct:free', enabled: true, timeoutMs: 30000, supportsVision: true },
  { id: 'c_cf_llama', name: 'Cloudflare Llama 3.3 70B', provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', enabled: true, timeoutMs: 30000, supportsVision: false },
  { id: 'c_cf_qwq', name: 'Cloudflare QwQ 32B', provider: 'cloudflare', model: '@cf/qwen/qwq-32b', enabled: true, timeoutMs: 35000, supportsVision: false },
  { id: 'c_gemini_lite', name: 'Gemini 3.1 Flash Lite', provider: 'gemini', model: 'gemini-3.1-flash-lite', enabled: true, timeoutMs: 25000, supportsVision: true },
];

export function generateVaultToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ffr_${hex}`;
}

function emptySlot(includeAccountId = false): ProviderKeySlot {
  return {
    primary: '',
    backups: ['', '', ''],
    ...(includeAccountId ? { accountId: '' } : {}),
  };
}

export function createDefaultVault(): UserVault {
  return {
    apiToken: generateVaultToken(),
    providers: {
      gemini: emptySlot(),
      anthropic: emptySlot(),
      groq: emptySlot(),
      openrouter: emptySlot(),
      cloudflare: emptySlot(true),
    },
    chain: DEFAULT_CHAIN,
    updatedAt: new Date().toISOString(),
  };
}

export function loadVaultFromStorage(): UserVault {
  const fallback = createDefaultVault();
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<UserVault>;
    const providers: Record<VaultProviderId, ProviderKeySlot> = {
      gemini: { ...fallback.providers.gemini, ...(parsed.providers?.gemini || {}) },
      anthropic: { ...fallback.providers.anthropic, ...(parsed.providers?.anthropic || {}) },
      groq: { ...fallback.providers.groq, ...(parsed.providers?.groq || {}) },
      openrouter: { ...fallback.providers.openrouter, ...(parsed.providers?.openrouter || {}) },
      cloudflare: { ...fallback.providers.cloudflare, ...(parsed.providers?.cloudflare || {}) },
    };
    (['gemini', 'anthropic', 'groq', 'openrouter', 'cloudflare'] as VaultProviderId[]).forEach((p) => {
      const b = providers[p].backups;
      providers[p].backups = [b?.[0] || '', b?.[1] || '', b?.[2] || ''];
    });
    return {
      apiToken: parsed.apiToken?.startsWith('ffr_') ? parsed.apiToken : fallback.apiToken,
      providers,
      chain: Array.isArray(parsed.chain) && parsed.chain.length > 0 ? parsed.chain : DEFAULT_CHAIN,
      updatedAt: parsed.updatedAt || fallback.updatedAt,
    };
  } catch {
    return fallback;
  }
}

export function saveVaultToStorage(vault: UserVault): void {
  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
  } catch {
    // ignore quota errors
  }
}

export function countProviderKeys(vault: UserVault, provider: VaultProviderId): number {
  const slot = vault.providers[provider];
  if (!slot) return 0;
  if (provider === 'cloudflare' && !slot.accountId?.trim()) return 0;
  let count = slot.primary?.trim() ? 1 : 0;
  for (const b of slot.backups || []) {
    if (b?.trim()) count++;
  }
  return count;
}
