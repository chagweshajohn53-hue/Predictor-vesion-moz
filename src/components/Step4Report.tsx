import { Download, MessageSquare, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import type { SimulationWorkspace } from '../types/mirofish';

interface Props {
  workspace: SimulationWorkspace;
  loading: boolean;
  error: string | null;
  onRegenerateReport: () => void;
  onOpenChat: () => void;
}

export function Step4Report({
  workspace,
  loading,
  error,
  onRegenerateReport,
  onOpenChat,
}: Props) {
  const report = workspace.report;

  const exportMarkdown = () => {
    if (!report) return;
    const md = [
      `# ${workspace.title} — MiroFish Forecast Report`,
      `Generated: ${report.generatedAt} | Engine: ${report.engineUsed}`,
      '',
      `## Prompt Directive`,
      workspace.directive.prompt,
      '',
      `## Headline Verdict (${report.consensusProbability}% Consensus · ${report.confidenceScore}% Confidence)`,
      report.headlineVerdict,
      '',
      `## Direct Forecast`,
      report.directAnswer,
      '',
      `## Probability Breakdown`,
      ...report.probabilityBreakdown.map((p) => `- **${p.label}**: ${p.probability}% — ${p.rationale}`),
      '',
      `## Time-Horizon Outlook`,
      ...report.timeHorizonOutlook.map(
        (h) => `- **${h.timeframe} (${h.expectedDirection})**: ${h.outlook} [Driver: ${h.keyDriver}]`
      ),
      '',
      `## Key Catalysts`,
      ...report.keyCatalysts.map((c) => `- ${c}`),
      '',
      `## Invalidation Triggers`,
      ...report.invalidationTriggers.map((t) => `- ${t}`),
      '',
      `## Prompt Compliance Audit`,
      report.promptComplianceCheck,
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workspace.id}_forecast.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 text-balance">
            04. Calibrated Prediction Report
          </h1>
          <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
            Synthesized from multi-round swarm convergence, uploaded visual/article evidence, and
            strict prompt-adherence verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={onRegenerateReport}
            className="px-3.5 py-2 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Re-Synthesize
          </button>

          {report && (
            <button
              type="button"
              onClick={exportMarkdown}
              className="px-3.5 py-2 rounded-md border border-slate-700 bg-[#111827] hover:border-slate-500 text-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export Markdown
            </button>
          )}

          <button
            type="button"
            onClick={onOpenChat}
            className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Interrogate Agents
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-8 flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          Synthesizing calibrated forecast report from swarm simulation rounds...
        </div>
      )}

      {report && (
        <div className="space-y-6">
          {/* Headline Verdict & Direct Answer */}
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/70 pb-5">
              <div className="space-y-1 max-w-3xl">
                <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                  <span>{report.engineUsed}</span>
                  <span aria-hidden="true">·</span>
                  <span>{workspace.directive.horizon}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">
                    {new Date(report.generatedAt).toLocaleString()}
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-slate-100 text-balance">
                  {report.headlineVerdict}
                </h2>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                <div>
                  <div className="text-xs text-slate-400">Primary Consensus</div>
                  <div className="text-2xl font-semibold font-mono-tabular text-sky-400">
                    {report.consensusProbability}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Calibrated Confidence</div>
                  <div className="text-2xl font-semibold font-mono-tabular text-emerald-400">
                    {report.confidenceScore}%
                  </div>
                </div>
              </div>
            </div>

            <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-line max-w-4xl">
              {report.directAnswer}
            </div>

            <div className="pt-4 border-t border-slate-800/70 text-xs text-slate-400">
              <span className="font-medium text-slate-300">Prompt Compliance Audit: </span>
              {report.promptComplianceCheck}
            </div>
          </div>

          {/* Probability Breakdown & Time Horizon */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-100">Outcome Probability Split</h3>
              <div className="space-y-4">
                {report.probabilityBreakdown.map((item, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-200">{item.label}</span>
                      <span className="font-mono-tabular text-sky-400 font-semibold">
                        {item.probability}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#0B0F17] overflow-hidden border border-slate-800/80">
                      <div
                        className="h-full bg-sky-400"
                        style={{ width: `${Math.min(100, Math.max(2, item.probability))}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400">{item.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-100">Time-Horizon Trajectory</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 border-b border-slate-800/80">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Horizon</th>
                      <th className="py-2 pr-3 font-medium">Direction</th>
                      <th className="py-2 pr-3 font-medium">Expected Trajectory</th>
                      <th className="py-2 font-medium">Primary Driver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {report.timeHorizonOutlook.map((row, i) => (
                      <tr key={i} className="text-slate-200">
                        <td className="py-3 pr-3 font-mono-tabular whitespace-nowrap text-sky-300">
                          {row.timeframe}
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap font-medium">
                          {row.expectedDirection}
                        </td>
                        <td className="py-3 pr-3 text-slate-300">{row.outlook}</td>
                        <td className="py-3 text-slate-400">{row.keyDriver}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Catalysts vs Invalidation Triggers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-semibold text-emerald-400">
                Key Supporting Catalysts
              </h3>
              <ul className="space-y-2 text-sm text-slate-300 list-disc pl-4">
                {report.keyCatalysts.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>

            <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-semibold text-rose-400">
                Invalidation &amp; Reversal Triggers
              </h3>
              <ul className="space-y-2 text-sm text-slate-300 list-disc pl-4">
                {report.invalidationTriggers.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Model Chain & Failover Hops Audit */}
          <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-400">
                Predictor Proxy Audit ({report.decisionSource})
              </h3>
              <span className="font-mono-tabular text-xs text-slate-400">
                Models: {report.modelsUsed?.join(' · ') || report.engineUsed}
              </span>
            </div>

            {report.hops && report.hops.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500 border-b border-slate-800/70">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Provider</th>
                      <th className="py-1.5 pr-3 font-medium">Model</th>
                      <th className="py-1.5 pr-3 font-medium">Result</th>
                      <th className="py-1.5 text-right font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {report.hops.map((hop, idx) => (
                      <tr key={idx} className="text-slate-300">
                        <td className="py-2 pr-3 capitalize">{hop.provider}</td>
                        <td className="py-2 pr-3 font-mono-tabular">{hop.model}</td>
                        <td className={`py-2 pr-3 ${hop.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {hop.detail}
                        </td>
                        <td className="py-2 text-right font-mono-tabular text-slate-400">
                          {hop.latencyMs}ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grounded Citations Footer */}
          {workspace.evidenceSummary && workspace.evidenceSummary.groundedSources.length > 0 && (
            <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-2.5">
              <h3 className="text-xs font-medium text-slate-400">Verified Grounding Sources</h3>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {workspace.evidenceSummary.groundedSources.map((src, i) => (
                  <a
                    key={i}
                    href={src.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-sky-400 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span>{src.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
