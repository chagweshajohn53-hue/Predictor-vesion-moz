import { useState } from 'react';
import { RefreshCw, Plus, Play, Loader2 } from 'lucide-react';
import type { AgentPersona, SimulationWorkspace } from '../types/mirofish';

interface Props {
  workspace: SimulationWorkspace;
  loading: boolean;
  error: string | null;
  onChangeWorkspace: (updater: (prev: SimulationWorkspace) => SimulationWorkspace) => void;
  onRegeneratePersonas: () => void;
  onLaunchSimulation: () => void;
}

export function Step2EnvSetup({
  workspace,
  loading,
  error,
  onChangeWorkspace,
  onRegeneratePersonas,
  onLaunchSimulation,
}: Props) {
  const [customName, setCustomName] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [customBias, setCustomBias] = useState('');
  const [customProb, setCustomProb] = useState(50);

  const toggleAgent = (id: string) => {
    onChangeWorkspace((prev) => ({
      ...prev,
      agents: prev.agents.map((a) => (a.id === id ? { ...a, active: !a.active } : a)),
    }));
  };

  const updateAgentProb = (id: string, value: number) => {
    const clamped = Math.max(1, Math.min(99, value));
    onChangeWorkspace((prev) => ({
      ...prev,
      agents: prev.agents.map((a) =>
        a.id === id ? { ...a, currentProbability: clamped } : a
      ),
    }));
  };

  const handleAddCustomAgent = () => {
    if (!customName.trim() || !customRole.trim()) return;
    const newAgent: AgentPersona = {
      id: `custom_${Date.now().toString(36)}`,
      name: customName.trim(),
      role: customRole.trim(),
      archetype: 'Custom Stakeholder',
      bias: customBias.trim() || 'Independent analytical lens',
      active: true,
      initialConfidence: 75,
      currentProbability: Math.max(1, Math.min(99, customProb)),
      memory: [],
    };
    onChangeWorkspace((prev) => ({
      ...prev,
      agents: [...prev.agents, newAgent],
    }));
    setCustomName('');
    setCustomRole('');
    setCustomBias('');
    setCustomProb(50);
  };

  const activeCount = workspace.agents.filter((a) => a.active).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 text-balance">
            02. Swarm Environment &amp; Persona Calibration
          </h1>
          <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
            Review the autonomous agent archetypes generated from your knowledge graph. Enable,
            adjust, or inject custom stakeholders before launching multi-round debate.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#111827] border border-slate-800 rounded-md px-3 py-2">
            <label htmlFor="rounds-select" className="text-xs text-slate-400 whitespace-nowrap">
              Debate Rounds
            </label>
            <select
              id="rounds-select"
              value={workspace.directive.roundsCount}
              onChange={(e) =>
                onChangeWorkspace((prev) => ({
                  ...prev,
                  directive: { ...prev.directive, roundsCount: Number(e.target.value) },
                }))
              }
              className="bg-transparent text-xs font-mono-tabular text-slate-100 focus:outline-none"
            >
              {[3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n} className="bg-[#111827]">
                  {n} rounds
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={onRegeneratePersonas}
            className="px-3.5 py-2 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Regenerate Personas
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && workspace.agents.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="h-44 rounded-lg border border-slate-800/80 bg-[#111827] animate-pulse p-5"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {workspace.agents.map((agent) => (
            <div
              key={agent.id}
              className={`rounded-lg border p-5 transition-colors flex flex-col justify-between gap-4 ${
                agent.active
                  ? 'border-slate-800/90 bg-[#111827]'
                  : 'border-slate-800/40 bg-[#0D121D] opacity-60'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                      <span>{agent.archetype}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">Conf {agent.initialConfidence}%</span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-100 mt-0.5 truncate">
                      {agent.name}
                    </h3>
                    <div className="text-xs text-sky-400 truncate">{agent.role}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleAgent(agent.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors shrink-0 ${
                      agent.active
                        ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                        : 'border-slate-700 text-slate-400 bg-slate-900'
                    }`}
                  >
                    {agent.active ? 'Active' : 'Muted'}
                  </button>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{agent.bias}</p>
              </div>

              <div className="pt-3 border-t border-slate-800/70 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Prior Outcome Probability</span>
                  <span className="font-mono-tabular text-slate-100 font-medium">
                    {agent.currentProbability}%
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={agent.currentProbability}
                  onChange={(e) => updateAgentProb(agent.id, Number(e.target.value))}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom Agent Adder */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Add Custom Stakeholder Agent</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Agent name"
            className="rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
          <input
            type="text"
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            placeholder="Role (e.g., Central Bank Hawk)"
            className="rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
          <input
            type="text"
            value={customBias}
            onChange={(e) => setCustomBias(e.target.value)}
            placeholder="Analytical bias / incentive"
            className="lg:col-span-2 rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={99}
              value={customProb}
              onChange={(e) => setCustomProb(Number(e.target.value))}
              className="w-20 rounded-md bg-[#0B0F17] border border-slate-800 px-2.5 py-2 text-sm font-mono-tabular text-slate-100 focus:outline-none focus:border-sky-400"
              title="Initial probability %"
            />
            <button
              type="button"
              onClick={handleAddCustomAgent}
              disabled={!customName.trim() || !customRole.trim()}
              className="flex-1 px-3 py-2 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 disabled:opacity-50 text-slate-100 text-xs font-medium transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Agent
            </button>
          </div>
        </div>
      </div>

      {/* Footer Action */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-slate-400 font-mono-tabular">
          {activeCount} active agents · {workspace.directive.roundsCount} scheduled rounds
        </div>

        <button
          type="button"
          disabled={loading || activeCount === 0}
          onClick={onLaunchSimulation}
          className="px-5 py-2.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Preparing Swarm...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Enter Simulation Stage
            </>
          )}
        </button>
      </div>
    </div>
  );
}
