import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { SimulationWorkspace } from '../types/mirofish';

interface Props {
  workspace: SimulationWorkspace;
  sending: boolean;
  error: string | null;
  onSendMessage: (targetId: string, message: string) => Promise<void>;
}

const SUGGESTED_QUESTIONS = [
  'Which single piece of evidence carried the most weight in this forecast?',
  'What event would cause you to flip your prediction completely?',
  'Explain the primary disagreement between bullish and bearish agents.',
];

export function Step5Chat({ workspace, sending, error, onSendMessage }: Props) {
  const [targetId, setTargetId] = useState<string>('report_agent');
  const [draft, setDraft] = useState('');

  const activeThread = workspace.chatThreads[targetId] || [];
  const selectedAgent = workspace.agents.find((a) => a.id === targetId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    await onSendMessage(targetId, text);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-6">
        <h1 className="text-2xl font-semibold text-slate-100 text-balance">
          05. Deep Agent Interrogation &amp; Rehearsal
        </h1>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
          Question the synthesis ReportAgent or any individual simulated persona to stress-test
          assumptions and explore counterfactual paths.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Target Selector */}
        <div className="lg:col-span-4 bg-[#111827] border border-slate-800/80 rounded-lg p-4 space-y-2">
          <div className="text-xs font-medium text-slate-400 px-1 pb-1">Select Target</div>

          <button
            type="button"
            onClick={() => setTargetId('report_agent')}
            className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
              targetId === 'report_agent'
                ? 'border-sky-500/50 bg-[#161F30] text-sky-300'
                : 'border-slate-800/70 bg-[#0B0F17] text-slate-200 hover:border-slate-700'
            }`}
          >
            <div className="text-sm font-semibold">ReportAgent (Chief Forecaster)</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Synthesizes all swarm rounds &amp; evidence
            </div>
          </button>

          <div className="pt-2 border-t border-slate-800/70 space-y-1.5">
            {workspace.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setTargetId(agent.id)}
                className={`w-full text-left px-3 py-2 rounded-md border transition-colors flex items-center justify-between gap-2 ${
                  targetId === agent.id
                    ? 'border-sky-500/50 bg-[#161F30] text-sky-300'
                    : 'border-slate-800/70 bg-[#0B0F17] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{agent.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{agent.role}</div>
                </div>
                <span className="font-mono-tabular text-xs text-slate-300 shrink-0">
                  {agent.currentProbability}%
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Stage */}
        <div className="lg:col-span-8 bg-[#111827] border border-slate-800/80 rounded-lg flex flex-col h-[540px]">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">
                {selectedAgent ? selectedAgent.name : 'ReportAgent'}
              </div>
              <div className="text-xs text-slate-400">
                {selectedAgent
                  ? `${selectedAgent.role} · Current Estimate ${selectedAgent.currentProbability}%`
                  : 'Chief Synthesis & Calibration Engine'}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {activeThread.length === 0 ? (
              <div className="space-y-4 pt-6">
                <p className="text-sm text-slate-400">
                  Ask a direct question or test a scenario below:
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onSendMessage(targetId, q)}
                      className="text-left text-xs text-slate-300 hover:text-sky-300 bg-[#0B0F17] border border-slate-800 hover:border-sky-500/40 rounded-md px-3 py-2 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeThread.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1.5">
                    <span>{msg.senderName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                      msg.role === 'user'
                        ? 'bg-sky-500/15 border border-sky-500/30 text-slate-100'
                        : 'bg-[#0B0F17] border border-slate-800 text-slate-200'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-slate-800/80 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Ask ${selectedAgent ? selectedAgent.name : 'ReportAgent'}...`}
              className="flex-1 rounded-md bg-[#0B0F17] border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="px-4 py-2.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
