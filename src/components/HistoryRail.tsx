import { Trash2, ChevronRight, KeyRound } from 'lucide-react';
import { countProviderKeys } from '../lib/vaultClient';
import type { SimulationStep, SimulationWorkspace, UserVault } from '../types/mirofish';

interface Props {
  activeWorkspace: SimulationWorkspace;
  savedWorkspaces: SimulationWorkspace[];
  vault: UserVault;
  cloudConnected?: boolean;
  onSelectStep: (step: SimulationStep) => void;
  onLoadWorkspace: (workspace: SimulationWorkspace) => void;
  onDeleteWorkspace: (id: string) => void;
}

const STEPS: Array<{ step: SimulationStep; label: string; caption: string }> = [
  { step: 1, label: '01. Seed & Graph', caption: 'Images, URLs & entities' },
  { step: 2, label: '02. Swarm Setup', caption: 'Persona calibration' },
  { step: 3, label: '03. Simulation', caption: 'Multi-round debate' },
  { step: 4, label: '04. Forecast Report', caption: 'Probability & catalysts' },
  { step: 5, label: '05. Agent Chat', caption: 'Deep interrogation' },
];

export function HistoryRail({
  activeWorkspace,
  savedWorkspaces,
  vault,
  cloudConnected = false,
  onSelectStep,
  onLoadWorkspace,
  onDeleteWorkspace,
}: Props) {
  const canVisitStep = (step: SimulationStep): boolean => {
    if (step === 1 || step === 6) return true;
    if (step === 2) return Boolean(activeWorkspace.graph);
    if (step === 3) return activeWorkspace.agents.length > 0;
    if (step === 4) return activeWorkspace.rounds.length > 0 || Boolean(activeWorkspace.report);
    if (step === 5) return Boolean(activeWorkspace.graph);
    return false;
  };

  const safeWorkspaces = Array.isArray(savedWorkspaces) ? savedWorkspaces : [];
  const totalVaultKeys =
    countProviderKeys(vault, 'gemini') +
    countProviderKeys(vault, 'anthropic') +
    countProviderKeys(vault, 'groq') +
    countProviderKeys(vault, 'grok') +
    countProviderKeys(vault, 'openrouter') +
    countProviderKeys(vault, 'cloudflare');
  const enabledModels = (vault.chain || []).filter((c) => c.enabled).length;

  return (
    <aside className="w-full lg:w-[272px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800/80 bg-[#0E1420] flex flex-col">
      {/* Pipeline Navigation */}
      <div className="p-5 border-b border-slate-800/80">
        <div className="text-xs font-medium text-slate-400 mb-3">Simulation Pipeline</div>
        <nav className="space-y-1">
          {STEPS.map(({ step, label, caption }) => {
            const enabled = canVisitStep(step);
            const active = activeWorkspace.currentStep === step;
            return (
              <button
                key={step}
                type="button"
                disabled={!enabled}
                onClick={() => onSelectStep(step)}
                className={`w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-center justify-between gap-2 ${
                  active
                    ? 'bg-[#161F30] text-sky-400 border border-slate-700/80'
                    : enabled
                      ? 'text-slate-200 hover:bg-slate-800/50 border border-transparent'
                      : 'text-slate-600 cursor-not-allowed border border-transparent'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{label}</div>
                  <div className="text-xs text-slate-400 truncate">{caption}</div>
                </div>
                {active && <ChevronRight className="w-4 h-4 shrink-0 text-sky-400" />}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Client Vault Summary */}
      <div className="px-5 py-4 border-b border-slate-800/80 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Client Key Vault</span>
          <span className="font-mono-tabular text-[11px] text-sky-400">
            {totalVaultKeys} keys · {enabledModels} models
          </span>
        </div>

        <div className="space-y-1 text-xs">
          {(
            [
              ['gemini', 'Gemini'],
              ['anthropic', 'Claude'],
              ['groq', 'Groq'],
              ['grok', 'xAI Grok'],
              ['openrouter', 'OpenRouter'],
              ['cloudflare', 'Cloudflare'],
            ] as const
          ).map(([id, label]) => {
            const count = countProviderKeys(vault, id);
            return (
              <div key={id} className="flex items-center justify-between gap-2">
                <span className="text-slate-300">{label}</span>
                <span className={`font-mono-tabular ${count > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {count > 0 ? `${count} pooled` : 'Empty'}
                </span>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onSelectStep(6)}
          className={`w-full px-3 py-2 rounded-md border text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            activeWorkspace.currentStep === 6
              ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
              : 'border-slate-800 bg-[#111827] hover:border-sky-400 text-slate-200'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          Manage Keys &amp; Failover Chain
        </button>
      </div>

      {/* Saved Simulations Archive */}
      <div className="p-5 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-400">Saved Forecasts</span>
          <span className="font-mono-tabular text-xs text-slate-500">
            {cloudConnected ? 'Firebase · ' : ''}
            {safeWorkspaces.length}
          </span>
        </div>

        {safeWorkspaces.length === 0 ? (
          <p className="text-xs text-slate-500 leading-relaxed">
            Completed graph builds and forecasts are automatically saved here for revisiting.
          </p>
        ) : (
          <ul className="space-y-2">
            {safeWorkspaces.map((item) => {
              const isCurrent = item.id === activeWorkspace.id;
              return (
                <li
                  key={item.id}
                  className={`group rounded-md border transition-colors ${
                    isCurrent
                      ? 'border-sky-500/40 bg-[#161F30]'
                      : 'border-slate-800/70 bg-[#111827] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 p-2.5">
                    <button
                      type="button"
                      onClick={() => onLoadWorkspace(item)}
                      className="text-left min-w-0 flex-1"
                    >
                      <div className="text-xs font-medium text-slate-200 truncate">
                        {item.title || 'Untitled Forecast'}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 font-mono-tabular">
                        <span>
                          {item.report
                            ? `${item.report.consensusProbability}%`
                            : `Step ${item.currentStep}`}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteWorkspace(item.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-colors shrink-0"
                      title="Delete saved forecast"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
