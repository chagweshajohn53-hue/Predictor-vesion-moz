import { Trash2, ChevronRight } from 'lucide-react';
import type { ProxyProviderStatus, SimulationStep, SimulationWorkspace } from '../types/mirofish';

interface Props {
  activeWorkspace: SimulationWorkspace;
  savedWorkspaces: SimulationWorkspace[];
  proxyStatus: ProxyProviderStatus | null;
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
  proxyStatus,
  onSelectStep,
  onLoadWorkspace,
  onDeleteWorkspace,
}: Props) {
  const canVisitStep = (step: SimulationStep): boolean => {
    if (step === 1) return true;
    if (step === 2) return Boolean(activeWorkspace.graph);
    if (step === 3) return activeWorkspace.agents.length > 0;
    if (step === 4) return activeWorkspace.rounds.length > 0 || Boolean(activeWorkspace.report);
    if (step === 5) return Boolean(activeWorkspace.graph);
    return false;
  };

  const activeSlots = (proxyStatus?.chain || []).filter((s) => s.configured);

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

      {/* Failover Model Chain (Prdictor-op Placement) */}
      <div className="px-5 py-4 border-b border-slate-800/80 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Failover Model Chain</span>
          <span className="font-mono-tabular text-[11px] text-slate-500">
            {activeSlots.length} ready
          </span>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300 truncate">Claude Haiku 5.5</span>
            <span className={proxyStatus?.anthropicConfigured ? 'text-emerald-400 shrink-0' : 'text-slate-500 shrink-0'}>
              {proxyStatus?.anthropicConfigured ? 'Specialist' : 'Optional'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300 truncate">Gemini 4 Hydrogen</span>
            <span className={proxyStatus?.geminiConfigured ? 'text-emerald-400 shrink-0' : 'text-amber-400 shrink-0'}>
              {proxyStatus?.geminiConfigured ? 'Primary' : 'Missing'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300 truncate">Groq / OpenRouter / CF</span>
            <span
              className={
                proxyStatus?.groqConfigured ||
                proxyStatus?.openrouterConfigured ||
                proxyStatus?.cloudflareConfigured
                  ? 'text-emerald-400 shrink-0'
                  : 'text-slate-500 shrink-0'
              }
            >
              {proxyStatus?.groqConfigured ||
              proxyStatus?.openrouterConfigured ||
              proxyStatus?.cloudflareConfigured
                ? 'Active Pool'
                : 'Optional'}
            </span>
          </div>
        </div>
      </div>

      {/* Saved Simulations Archive */}
      <div className="p-5 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-400">Saved Forecasts</span>
          <span className="font-mono-tabular text-xs text-slate-500">
            {savedWorkspaces.length}
          </span>
        </div>

        {savedWorkspaces.length === 0 ? (
          <p className="text-xs text-slate-500 leading-relaxed">
            Completed graph builds and forecasts are automatically saved here for revisiting.
          </p>
        ) : (
          <ul className="space-y-2">
            {savedWorkspaces.map((item) => {
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
