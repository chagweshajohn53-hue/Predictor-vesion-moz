import { useMemo, useState } from 'react';
import { Play, FastForward, Zap, ArrowRight, Loader2, RotateCcw } from 'lucide-react';
import type { SimulationWorkspace } from '../types/mirofish';

interface Props {
  workspace: SimulationWorkspace;
  running: boolean;
  error: string | null;
  onRunNextRound: (shockText?: string) => Promise<void>;
  onRunAllRemaining: () => Promise<void>;
  onResetRounds: () => void;
  onGenerateReport: () => void;
}

export function Step3Simulation({
  workspace,
  running,
  error,
  onRunNextRound,
  onRunAllRemaining,
  onResetRounds,
  onGenerateReport,
}: Props) {
  const [shockDraft, setShockDraft] = useState('');
  const [stanceFilter, setStanceFilter] = useState<'all' | 'bullish' | 'bearish' | 'neutral'>('all');
  const [selectedRoundNum, setSelectedRoundNum] = useState<number | null>(null);

  const rounds = workspace.rounds;
  const latestRound = rounds[rounds.length - 1] ?? null;
  const activeRound =
    rounds.find((r) => r.roundNumber === selectedRoundNum) ?? latestRound;

  const filteredEntries = useMemo(() => {
    if (!activeRound) return [];
    if (stanceFilter === 'all') return activeRound.entries;
    return activeRound.entries.filter((e) => e.stance === stanceFilter);
  }, [activeRound, stanceFilter]);

  const remainingRounds = Math.max(0, workspace.directive.roundsCount - rounds.length);

  // SVG Chart Geometry for Consensus Trajectory
  const chartPoints = useMemo(() => {
    if (rounds.length === 0) return '';
    const w = 640;
    const h = 160;
    const padX = 36;
    const padY = 20;
    const spanX = w - padX * 2;
    const spanY = h - padY * 2;
    return rounds
      .map((r, idx) => {
        const x =
          rounds.length === 1
            ? w / 2
            : padX + (idx / (rounds.length - 1)) * spanX;
        const y = padY + ((100 - r.consensusProbability) / 100) * spanY;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [rounds]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 text-balance">
            03. Multi-Round Swarm Simulation
          </h1>
          <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
            Watch autonomous agents debate evidence across rounds, shift probability weights, and
            react dynamically when you inject "what-if" shocks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {rounds.length > 0 && (
            <button
              type="button"
              disabled={running}
              onClick={onResetRounds}
              className="px-3 py-2 rounded-md border border-slate-700 bg-[#111827] hover:border-slate-500 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          )}

          <button
            type="button"
            disabled={running}
            onClick={() => onRunNextRound()}
            className="px-4 py-2 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 disabled:opacity-50 text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 text-sky-400" />
            )}
            Run Next Round ({rounds.length + 1})
          </button>

          {remainingRounds > 0 && (
            <button
              type="button"
              disabled={running}
              onClick={onRunAllRemaining}
              className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <FastForward className="w-3.5 h-3.5" />
              Run All Remaining ({remainingRounds})
            </button>
          )}

          {rounds.length > 0 && (
            <button
              type="button"
              disabled={running}
              onClick={onGenerateReport}
              className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              Compile Report
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Top Metrics + Trajectory Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#111827] border border-slate-800/80 rounded-lg p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-baseline justify-between border-b border-slate-800/70 pb-3">
              <span className="text-xs text-slate-400">Current Consensus</span>
              <span className="text-3xl font-semibold font-mono-tabular text-sky-400">
                {latestRound ? `${latestRound.consensusProbability}%` : '--'}
              </span>
            </div>

            <div className="flex items-baseline justify-between border-b border-slate-800/70 pb-3">
              <span className="text-xs text-slate-400">Agent Spread (Std Dev)</span>
              <span className="text-lg font-medium font-mono-tabular text-slate-200">
                {latestRound ? `±${latestRound.disagreementIndex}%` : '--'}
              </span>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-400">Completed Rounds</span>
              <span className="text-lg font-medium font-mono-tabular text-slate-200">
                {rounds.length} / {workspace.directive.roundsCount}
              </span>
            </div>
          </div>

          {/* Shock Variable Injection */}
          <div className="pt-4 border-t border-slate-800/80 space-y-2">
            <label htmlFor="shock-input" className="block text-xs font-medium text-slate-300">
              Inject "What-If" Shock Variable
            </label>
            <div className="flex gap-2">
              <input
                id="shock-input"
                type="text"
                value={shockDraft}
                onChange={(e) => setShockDraft(e.target.value)}
                placeholder="e.g., Surprise 50bps rate cut announced..."
                className="flex-1 rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                disabled={running || !shockDraft.trim()}
                onClick={async () => {
                  const text = shockDraft.trim();
                  setShockDraft('');
                  await onRunNextRound(text);
                }}
                className="px-3 py-2 rounded-md border border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 disabled:opacity-40 text-amber-200 text-xs font-medium transition-colors flex items-center gap-1 shrink-0"
              >
                <Zap className="w-3.5 h-3.5" />
                Inject
              </button>
            </div>
          </div>
        </div>

        {/* Trajectory Chart */}
        <div className="lg:col-span-8 bg-[#111827] border border-slate-800/80 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-200">
              Consensus Probability Trajectory
            </h3>
            <span className="text-xs text-slate-400 font-mono-tabular">0% – 100% Scale</span>
          </div>

          {rounds.length === 0 ? (
            <div className="h-[175px] flex items-center justify-center border border-dashed border-slate-800 rounded bg-[#0B0F17] text-xs text-slate-500">
              Run Round 1 to plot multi-agent consensus convergence.
            </div>
          ) : (
            <svg viewBox="0 0 640 160" className="w-full h-[175px] bg-[#0B0F17] rounded border border-slate-800/70">
              {[25, 50, 75].map((pct) => {
                const y = 20 + ((100 - pct) / 100) * 120;
                return (
                  <g key={pct}>
                    <line
                      x1={36}
                      y1={y}
                      x2={604}
                      y2={y}
                      stroke="rgba(148,163,184,0.12)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={10}
                      y={y + 3}
                      fill="#64748B"
                      fontSize="10"
                      className="font-mono-tabular"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {rounds.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="2.5"
                  points={chartPoints}
                />
              )}

              {rounds.map((r, idx) => {
                const x =
                  rounds.length === 1
                    ? 320
                    : 36 + (idx / (rounds.length - 1)) * 568;
                const y = 20 + ((100 - r.consensusProbability) / 100) * 120;
                const isSelected = activeRound?.roundNumber === r.roundNumber;
                return (
                  <g
                    key={r.roundNumber}
                    onClick={() => setSelectedRoundNum(r.roundNumber)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={isSelected ? 6 : 4.5}
                      fill={r.shockInjected ? '#F59E0B' : '#38BDF8'}
                      stroke="#0B0F17"
                      strokeWidth="2"
                    />
                    <text
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      fill="#E2E8F0"
                      fontSize="10.5"
                      className="font-mono-tabular font-semibold"
                    >
                      {r.consensusProbability}%
                    </text>
                    <text
                      x={x}
                      y={152}
                      textAnchor="middle"
                      fill="#94A3B8"
                      fontSize="10"
                      className="font-mono-tabular"
                    >
                      R{r.roundNumber}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Round Discourse Log */}
      {activeRound && (
        <div className="bg-[#111827] border border-slate-800/80 rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-100">
                Round {activeRound.roundNumber} Discourse
              </span>
              {rounds.length > 1 && (
                <div className="flex items-center gap-1">
                  {rounds.map((r) => (
                    <button
                      key={r.roundNumber}
                      type="button"
                      onClick={() => setSelectedRoundNum(r.roundNumber)}
                      className={`px-2 py-0.5 text-xs font-mono-tabular rounded transition-colors ${
                        activeRound.roundNumber === r.roundNumber
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      R{r.roundNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 bg-[#0B0F17] p-1 rounded border border-slate-800/80">
              {(['all', 'bullish', 'bearish', 'neutral'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStanceFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors ${
                    stanceFilter === st
                      ? 'bg-[#1E293B] text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-3 bg-[#0E1420] border-b border-slate-800/70 text-xs text-slate-300 space-y-1">
            {activeRound.shockInjected && (
              <div className="text-amber-300 font-medium">
                Shock Variable Injected: {activeRound.shockInjected}
              </div>
            )}
            <div>{activeRound.summary}</div>
          </div>

          <div className="divide-y divide-slate-800/70">
            {filteredEntries.map((entry) => (
              <div key={entry.agentId} className="p-5 flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{entry.agentName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{entry.role}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-sky-400/90">Cite: {entry.citedClaim}</span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{entry.reasoning}</p>
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-3 md:gap-1 shrink-0">
                  <div className="font-mono-tabular text-base font-semibold text-slate-100">
                    {entry.probability}%
                  </div>
                  <div className="text-xs font-mono-tabular flex items-center gap-2">
                    <span
                      className={`capitalize font-medium ${
                        entry.stance === 'bullish'
                          ? 'text-emerald-400'
                          : entry.stance === 'bearish'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {entry.stance}
                    </span>
                    <span className="text-slate-500">
                      ({entry.deltaFromPrevious >= 0 ? `+${entry.deltaFromPrevious}` : entry.deltaFromPrevious}%)
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
