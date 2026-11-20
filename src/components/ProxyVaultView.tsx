import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { testUnifiedRelayCompletion, testVaultProvider } from '../lib/api';
import {
  countProviderKeys,
  DEFAULT_CHAIN,
  generateVaultToken,
} from '../lib/vaultClient';
import type {
  ChainModelConfig,
  HopAudit,
  UserVault,
  VaultProviderId,
} from '../types/mirofish';

interface Props {
  vault: UserVault;
  syncStatus: 'idle' | 'saving' | 'synced' | 'error';
  cloudConnected: boolean;
  cloudUserEmail?: string | null;
  cloudStatus: 'idle' | 'saving' | 'saved' | 'error';
  onSignIn: () => void;
  onUpdateVault: (updater: (prev: UserVault) => UserVault) => void;
  onSyncNow: () => Promise<void>;
}

const PROVIDER_META: Array<{
  id: VaultProviderId;
  name: string;
  endpointNote: string;
  placeholder: string;
}> = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    endpointNote: 'generativelanguage.googleapis.com · Multimodal & Grounding',
    placeholder: 'AIza...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    endpointNote: 'api.anthropic.com · Claude Haiku 5.5 Vision & Final Review',
    placeholder: 'sk-ant-...',
  },
  {
    id: 'groq',
    name: 'Groq',
    endpointNote: 'api.groq.com/openai/v1 · High-speed Llama 3.3 70B',
    placeholder: 'gsk_...',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpointNote: 'openrouter.ai/api/v1 · Free Frontier Model Pool',
    placeholder: 'sk-or-v1-...',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    endpointNote: 'api.cloudflare.com/client/v4 · Edge Llama & QwQ',
    placeholder: 'Cloudflare API Token',
  },
];

export function ProxyVaultView({
  vault,
  syncStatus,
  cloudConnected,
  cloudUserEmail,
  cloudStatus,
  onSignIn,
  onUpdateVault,
  onSyncNow,
}: Props) {
  const [activeTab, setActiveTab] = useState<'vault' | 'chain' | 'export'>('vault');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<
    Record<string, { loading: boolean; ok?: boolean; latencyMs?: number; message?: string }>
  >({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Chain drag/add state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [newProvider, setNewProvider] = useState<VaultProviderId>('openrouter');
  const [newModelName, setNewModelName] = useState('');
  const [newModelId, setNewModelId] = useState('');

  // Live relay tester state
  const [livePrompt, setLivePrompt] = useState('Respond with three concise bullet points summarizing the advantage of multi-provider AI failover.');
  const [liveModel, setLiveModel] = useState('freeflow');
  const [liveTesting, setLiveTesting] = useState(false);
  const [liveResult, setLiveResult] = useState<{
    text?: string;
    model?: string;
    provider?: string;
    keySlot?: string;
    hops?: HopAudit[];
    error?: string;
  } | null>(null);

  const toggleReveal = (fieldId: string) => {
    setRevealed((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }));
  };

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(label);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleProviderKeyChange = (
    provider: VaultProviderId,
    slot: 'primary' | 'accountId' | 0 | 1 | 2,
    value: string
  ) => {
    onUpdateVault((prev) => {
      const current = prev.providers[provider];
      const nextBackups: [string, string, string] = [...current.backups] as [string, string, string];
      if (typeof slot === 'number') {
        nextBackups[slot] = value;
        return {
          ...prev,
          providers: {
            ...prev.providers,
            [provider]: { ...current, backups: nextBackups },
          },
        };
      }
      return {
        ...prev,
        providers: {
          ...prev.providers,
          [provider]: { ...current, [slot]: value },
        },
      };
    });
  };

  const handleTestProvider = async (provider: VaultProviderId) => {
    const slot = vault.providers[provider];
    const apiKey = slot.primary?.trim() || slot.backups.find((b) => b.trim()) || '';
    if (!apiKey) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { loading: false, ok: false, message: 'Enter a primary or backup key first.' },
      }));
      return;
    }

    setTestResults((prev) => ({ ...prev, [provider]: { loading: true } }));
    try {
      const res = await testVaultProvider({
        provider,
        apiKey,
        accountId: slot.accountId,
      });
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          loading: false,
          ok: res.ok,
          latencyMs: res.latencyMs,
          message: res.message,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          loading: false,
          ok: false,
          message: (err as Error).message,
        },
      }));
    }
  };

  const moveChainEntry = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= vault.chain.length || fromIndex === toIndex) return;
    onUpdateVault((prev) => {
      const next = [...prev.chain];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      return { ...prev, chain: next };
    });
  };

  const handleAddChainEntry = () => {
    if (!newModelId.trim()) return;
    const entry: ChainModelConfig = {
      id: `c_custom_${Date.now().toString(36)}`,
      name: newModelName.trim() || newModelId.trim(),
      provider: newProvider,
      model: newModelId.trim(),
      enabled: true,
      timeoutMs: 30000,
      supportsVision: newProvider === 'gemini' || newProvider === 'anthropic',
    };
    onUpdateVault((prev) => ({
      ...prev,
      chain: [entry, ...prev.chain],
    }));
    setNewModelName('');
    setNewModelId('');
  };

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.example';

  const curlSnippet = `curl ${originUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${vault.apiToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "freeflow",
    "messages": [
      { "role": "system", "content": "You are an analytical forecaster." },
      { "role": "user", "content": "Summarize key macro catalysts." }
    ],
    "temperature": 0.2,
    "stream": false
  }'`;

  const tsSnippet = `const response = await fetch("${originUrl}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${vault.apiToken}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "freeflow",
    messages: [{ role: "user", content: "Analyze this scenario..." }],
    stream: false,
  }),
});
const data = await response.json();
console.log(data.choices[0].message.content, data.hops);`;

  const handleRunLiveTest = async () => {
    setLiveTesting(true);
    setLiveResult(null);
    try {
      await onSyncNow();
      const res = await testUnifiedRelayCompletion({
        token: vault.apiToken,
        model: liveModel,
        prompt: livePrompt,
      });
      setLiveResult({
        text: res.choices?.[0]?.message?.content || '',
        model: res.model,
        provider: res.provider,
        keySlot: res.keySlot,
        hops: res.hops,
      });
    } catch (err) {
      setLiveResult({ error: (err as Error).message });
    } finally {
      setLiveTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 text-balance">
            Proxy Vault &amp; Resilient Failover Engine
          </h1>
          <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
            Manage client-owned provider keys with 1 primary + 3 backup pooling slots, reorder the
            model failover chain, and export drop-in API snippets.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {syncStatus === 'saving'
              ? 'Syncing vault...'
              : syncStatus === 'synced'
                ? 'Vault synced to relay'
                : syncStatus === 'error'
                  ? 'Local browser vault only'
                  : 'Vault ready'}
          </span>

          <div className="flex items-center gap-1 bg-[#111827] p-1 rounded-md border border-slate-800/80">
            {(
              [
                { id: 'vault', label: 'Key Vault' },
                { id: 'chain', label: 'Failover Chain' },
                { id: 'export', label: 'API Export' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TAB 1: KEY VAULT */}
      {activeTab === 'vault' && (
        <div className="space-y-6">
          {/* Firebase Cloud Persistence Bar */}
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-100">
                Firebase Cloud Persistence
              </div>
              <p className="text-xs text-slate-400">
                {cloudConnected
                  ? `Signed in as ${cloudUserEmail || 'Google Account'}. Your API keys, failover chain, and saved forecasts sync automatically to Firestore.`
                  : 'Sign in with Google to save your API keys, failover chain, and forecast archive securely to your Firebase account across devices.'}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {cloudConnected ? (
                <>
                  <span
                    className={`text-xs font-mono-tabular ${
                      cloudStatus === 'saved'
                        ? 'text-emerald-400'
                        : cloudStatus === 'saving'
                          ? 'text-sky-400'
                          : cloudStatus === 'error'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                    }`}
                  >
                    {cloudStatus === 'saved'
                      ? 'Saved to Firebase'
                      : cloudStatus === 'saving'
                        ? 'Saving to Firebase...'
                        : cloudStatus === 'error'
                          ? 'Firebase sync error'
                          : 'Cloud connected'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onSyncNow()}
                    className="px-3.5 py-2 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
                  >
                    Save to Firebase
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Sign in with Google to Save
                </button>
              )}
            </div>
          </div>

          {/* Bearer Token Card */}
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-100">
                Personal Relay Bearer Token
              </div>
              <p className="text-xs text-slate-400">
                Authenticate external apps against <span className="font-mono-tabular text-slate-300">/v1/chat/completions</span> without exposing upstream provider keys.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-1.5 gap-2">
                <input
                  type={revealed['vault_token'] ? 'text' : 'password'}
                  readOnly
                  value={vault.apiToken}
                  className="bg-transparent text-xs font-mono-tabular text-sky-300 w-56 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => toggleReveal('vault_token')}
                  className="text-slate-400 hover:text-slate-200"
                  title="Toggle token visibility"
                >
                  {revealed['vault_token'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleCopy('token', vault.apiToken)}
                className="px-3 py-2 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-xs text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiedKey === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'token' ? 'Copied' : 'Copy Token'}
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateVault((prev) => ({
                    ...prev,
                    apiToken: generateVaultToken(),
                  }))
                }
                className="px-3 py-2 rounded-md border border-slate-700 bg-[#111827] hover:border-slate-500 text-xs text-slate-300 flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate
              </button>
            </div>
          </div>

          {/* Provider Vault Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {PROVIDER_META.map((meta) => {
              const slot = vault.providers[meta.id];
              const keyCount = countProviderKeys(vault, meta.id);
              const test = testResults[meta.id];
              return (
                <div
                  key={meta.id}
                  className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-800/70 pb-3.5">
                    <div>
                      <div className="text-base font-semibold text-slate-100">{meta.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{meta.endpointNote}</div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono-tabular text-xs text-slate-400">
                        {keyCount} key{keyCount === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        disabled={test?.loading}
                        onClick={() => handleTestProvider(meta.id)}
                        className="px-3 py-1.5 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-xs font-medium text-slate-200 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {test?.loading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 text-sky-400" />
                        )}
                        Test Connection
                      </button>
                    </div>
                  </div>

                  {test && !test.loading && (
                    <div
                      className={`text-xs px-3 py-2 rounded border ${
                        test.ok
                          ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                      }`}
                    >
                      {test.ok
                        ? `${test.message} · ${test.latencyMs}ms`
                        : test.message}
                    </div>
                  )}

                  {meta.id === 'cloudflare' && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Cloudflare Account ID
                      </label>
                      <input
                        type="text"
                        value={slot.accountId || ''}
                        onChange={(e) => handleProviderKeyChange('cloudflare', 'accountId', e.target.value)}
                        placeholder="32-char Cloudflare Account ID"
                        className="w-full rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-xs font-mono-tabular text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-400"
                      />
                    </div>
                  )}

                  {/* Primary Key */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Primary Key
                    </label>
                    <div className="flex items-center bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-1.5 gap-2 focus-within:border-sky-400">
                      <input
                        type={revealed[`${meta.id}_primary`] ? 'text' : 'password'}
                        value={slot.primary}
                        onChange={(e) => handleProviderKeyChange(meta.id, 'primary', e.target.value)}
                        placeholder={meta.placeholder}
                        className="flex-1 bg-transparent text-xs font-mono-tabular text-slate-100 placeholder:text-slate-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleReveal(`${meta.id}_primary`)}
                        className="text-slate-500 hover:text-slate-200"
                      >
                        {revealed[`${meta.id}_primary`] ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 3 Backup Key Slots */}
                  <div className="space-y-2 pt-1">
                    <div className="text-xs text-slate-400">
                      Backup Pooling Keys (Tried sequentially on 429 / error)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {([0, 1, 2] as const).map((idx) => {
                        const fieldKey = `${meta.id}_b${idx}`;
                        return (
                          <div
                            key={idx}
                            className="flex items-center bg-[#0B0F17] border border-slate-800/80 rounded-md px-2.5 py-1.5 gap-1.5 focus-within:border-sky-400"
                          >
                            <input
                              type={revealed[fieldKey] ? 'text' : 'password'}
                              value={slot.backups[idx]}
                              onChange={(e) => handleProviderKeyChange(meta.id, idx, e.target.value)}
                              placeholder={`Backup ${idx + 1}`}
                              className="w-full min-w-0 bg-transparent text-xs font-mono-tabular text-slate-200 placeholder:text-slate-600 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => toggleReveal(fieldKey)}
                              className="text-slate-500 hover:text-slate-200 shrink-0"
                            >
                              {revealed[fieldKey] ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: REORDERABLE FAILOVER CHAIN */}
      {activeTab === 'chain' && (
        <div className="space-y-6">
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Priority Routing Chain
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Drag rows or use arrows to reorder fallback priority. Each model expands across its provider&apos;s Primary + 3 Backup keys automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onUpdateVault((prev) => ({ ...prev, chain: DEFAULT_CHAIN }))}
                className="px-3 py-1.5 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-xs text-slate-200 flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Default Order
              </button>
            </div>

            <div className="divide-y divide-slate-800/70">
              {vault.chain.map((entry, idx) => {
                const keysReady = countProviderKeys(vault, entry.provider);
                return (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) moveChainEntry(dragIndex, idx);
                      setDragIndex(null);
                    }}
                    className={`py-3 flex flex-wrap items-center justify-between gap-3 transition-opacity ${
                      entry.enabled ? 'opacity-100' : 'opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-slate-500 cursor-grab" title="Drag to reorder">
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <span className="font-mono-tabular text-xs text-slate-500 w-6">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {entry.name}
                        </div>
                        <div className="text-xs text-slate-400 font-mono-tabular flex items-center gap-2 truncate">
                          <span className="capitalize">{entry.provider}</span>
                          <span aria-hidden="true">·</span>
                          <span>{entry.model}</span>
                          <span aria-hidden="true">·</span>
                          <span className={keysReady > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                            {keysReady} key{keysReady === 1 ? '' : 's'} pooled
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 bg-[#0B0F17] border border-slate-800 rounded px-2 py-1">
                        <span className="text-[11px] text-slate-400">Timeout</span>
                        <input
                          type="number"
                          min={5000}
                          max={120000}
                          step={5000}
                          value={entry.timeoutMs}
                          onChange={(e) => {
                            const val = Math.max(5000, Number(e.target.value) || 30000);
                            onUpdateVault((prev) => ({
                              ...prev,
                              chain: prev.chain.map((c) =>
                                c.id === entry.id ? { ...c, timeoutMs: val } : c
                              ),
                            }));
                          }}
                          className="w-16 bg-transparent text-xs font-mono-tabular text-slate-200 text-right focus:outline-none"
                        />
                        <span className="text-[11px] text-slate-500">ms</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => moveChainEntry(idx, idx - 1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveChainEntry(idx, idx + 1)}
                        disabled={idx === vault.chain.length - 1}
                        className="p-1.5 rounded border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onUpdateVault((prev) => ({
                            ...prev,
                            chain: prev.chain.map((c) =>
                              c.id === entry.id ? { ...c, enabled: !c.enabled } : c
                            ),
                          }))
                        }
                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                          entry.enabled
                            ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                            : 'border-slate-700 text-slate-400 bg-slate-900'
                        }`}
                      >
                        {entry.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Custom Model Entry */}
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">Add Model to Chain</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value as VaultProviderId)}
                className="rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
                <option value="gemini">Google Gemini</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="cloudflare">Cloudflare Workers AI</option>
              </select>
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="Display Name"
                className="rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-400"
              />
              <input
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="Exact provider model ID"
                className="rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-xs font-mono-tabular text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                disabled={!newModelId.trim()}
                onClick={handleAddChainEntry}
                className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add to Top of Chain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DROP-IN API EXPORT & LIVE TESTER */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          {/* Live Chain Execution Tester */}
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Live Failover Proxy Test (<span className="font-mono-tabular text-sky-400">/v1/chat/completions</span>)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Fires a live completion through your synced Vault token and displays the exact provider hops &amp; latency.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={liveModel}
                  onChange={(e) => setLiveModel(e.target.value)}
                  className="rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-sky-400"
                >
                  <option value="freeflow">freeflow (Full Failover Chain)</option>
                  {vault.chain.filter((c) => c.enabled).map((c) => (
                    <option key={c.id} value={c.model}>
                      {c.model}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={liveTesting}
                  onClick={handleRunLiveTest}
                  className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 text-slate-950 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap"
                >
                  {liveTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Test Relay Endpoint
                </button>
              </div>
            </div>

            <input
              type="text"
              value={livePrompt}
              onChange={(e) => setLivePrompt(e.target.value)}
              className="w-full rounded-md bg-[#0B0F17] border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
            />

            {liveResult && (
              <div className="space-y-3 pt-2">
                {liveResult.error ? (
                  <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
                    {liveResult.error}
                  </div>
                ) : (
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-3">
                    <div className="text-xs text-slate-400 font-mono-tabular flex flex-wrap gap-2">
                      <span className="text-emerald-400">Served by {liveResult.provider}/{liveResult.model}</span>
                      <span aria-hidden="true">·</span>
                      <span>Key Slot: {liveResult.keySlot}</span>
                    </div>
                    <p className="text-sm text-slate-200 whitespace-pre-line">{liveResult.text}</p>

                    {liveResult.hops && liveResult.hops.length > 0 && (
                      <div className="pt-2 border-t border-slate-800/80 overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="py-1 pr-3 font-medium">Provider</th>
                              <th className="py-1 pr-3 font-medium">Model</th>
                              <th className="py-1 pr-3 font-medium">Key Slot</th>
                              <th className="py-1 pr-3 font-medium">Status</th>
                              <th className="py-1 text-right font-medium">Latency</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                            {liveResult.hops.map((h, i) => (
                              <tr key={i} className="text-slate-300">
                                <td className="py-1.5 pr-3 capitalize">{h.provider}</td>
                                <td className="py-1.5 pr-3 font-mono-tabular">{h.model}</td>
                                <td className="py-1.5 pr-3">{h.keySlot}</td>
                                <td className={`py-1.5 pr-3 font-mono-tabular ${h.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {h.status} {h.error ? `· ${h.error}` : ''}
                                </td>
                                <td className="py-1.5 text-right font-mono-tabular">{h.latencyMs}ms</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* cURL & TypeScript Snippets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">Drop-In cURL Export</h3>
                <button
                  type="button"
                  onClick={() => handleCopy('curl', curlSnippet)}
                  className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:border-sky-400 flex items-center gap-1"
                >
                  {copiedKey === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'curl' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-[#0B0F17] border border-slate-800 rounded p-3.5 text-xs font-mono-tabular text-slate-300 overflow-x-auto leading-relaxed">
                {curlSnippet}
              </pre>
            </div>

            <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">Zero-Dependency TypeScript Snippet</h3>
                <button
                  type="button"
                  onClick={() => handleCopy('ts', tsSnippet)}
                  className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:border-sky-400 flex items-center gap-1"
                >
                  {copiedKey === 'ts' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'ts' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-[#0B0F17] border border-slate-800 rounded p-3.5 text-xs font-mono-tabular text-slate-300 overflow-x-auto leading-relaxed">
                {tsSnippet}
              </pre>
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 text-xs text-slate-400 space-y-1.5">
            <div className="text-slate-200 font-medium">Available Unified Proxy Endpoints</div>
            <div><span className="font-mono-tabular text-sky-400">POST /v1/chat/completions</span> &amp; <span className="font-mono-tabular text-sky-400">POST /api/public/v1/chat/completions</span> — OpenAI-compatible chat failover</div>
            <div><span className="font-mono-tabular text-sky-400">POST /api/public/v1/generate</span> — Unified multimodal (prompt + base64 images) failover</div>
            <div><span className="font-mono-tabular text-sky-400">POST /api/public/relay</span> — Allowlisted stateless AI API relay with CORS support</div>
          </div>
        </div>
      )}
    </div>
  );
}
