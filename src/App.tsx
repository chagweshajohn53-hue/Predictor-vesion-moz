import { useCallback, useEffect, useState } from 'react';
import { HistoryRail } from './components/HistoryRail';
import { Step1SeedGraph } from './components/Step1SeedGraph';
import { Step2EnvSetup } from './components/Step2EnvSetup';
import { Step3Simulation } from './components/Step3Simulation';
import { Step4Report } from './components/Step4Report';
import { Step5Chat } from './components/Step5Chat';
import {
  createEmptyWorkspace,
  deleteSavedSimulation,
  extractKnowledgeGraph,
  fetchProxyStatus,
  generatePersonas,
  generateReport,
  listSavedSimulations,
  saveSimulationWorkspace,
  sendAgentChat,
  simulateRound,
} from './lib/api';
import type {
  ChatMessage,
  ProxyProviderStatus,
  SimulationStep,
  SimulationWorkspace,
} from './types/mirofish';

export default function App() {
  const [workspace, setWorkspace] = useState<SimulationWorkspace>(() => createEmptyWorkspace());
  const [savedWorkspaces, setSavedWorkspaces] = useState<SimulationWorkspace[]>([]);
  const [proxyStatus, setProxyStatus] = useState<ProxyProviderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProxyStatus()
      .then(setProxyStatus)
      .catch(() => setProxyStatus(null));

    listSavedSimulations()
      .then(({ simulations }) => setSavedWorkspaces(simulations))
      .catch(() => setSavedWorkspaces([]));
  }, []);

  const persistWorkspace = useCallback(async (next: SimulationWorkspace) => {
    try {
      const { simulation } = await saveSimulationWorkspace(next);
      setSavedWorkspaces((prev) => {
        const filtered = prev.filter((item) => item.id !== simulation.id);
        return [simulation, ...filtered];
      });
    } catch {
      // Non-fatal persistence error; keep local state active
    }
  }, []);

  const handleNewPrediction = () => {
    setError(null);
    setWorkspace(createEmptyWorkspace());
  };

  const handleSelectStep = (step: SimulationStep) => {
    setError(null);
    setWorkspace((prev) => ({ ...prev, currentStep: step }));
  };

  const handleBuildGraph = async () => {
    setError(null);
    setLoading(true);
    try {
      const { evidenceSummary, graph } = await extractKnowledgeGraph(
        workspace.directive,
        workspace.seeds
      );
      const updated: SimulationWorkspace = {
        ...workspace,
        evidenceSummary,
        graph,
      };
      setWorkspace(updated);
      await persistWorkspace(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToSwarm = async () => {
    if (!workspace.graph || !workspace.evidenceSummary) return;
    setError(null);
    if (workspace.agents.length > 0) {
      setWorkspace((prev) => ({ ...prev, currentStep: 2 }));
      return;
    }
    setLoading(true);
    setWorkspace((prev) => ({ ...prev, currentStep: 2 }));
    try {
      const { agents } = await generatePersonas(
        workspace.directive,
        workspace.evidenceSummary,
        workspace.graph
      );
      const updated: SimulationWorkspace = {
        ...workspace,
        currentStep: 2,
        agents,
      };
      setWorkspace(updated);
      await persistWorkspace(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegeneratePersonas = async () => {
    if (!workspace.graph || !workspace.evidenceSummary) return;
    setError(null);
    setLoading(true);
    try {
      const { agents } = await generatePersonas(
        workspace.directive,
        workspace.evidenceSummary,
        workspace.graph
      );
      const updated: SimulationWorkspace = {
        ...workspace,
        agents,
        rounds: [],
        report: null,
      };
      setWorkspace(updated);
      await persistWorkspace(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunRound = async (shockText?: string) => {
    if (!workspace.graph || !workspace.evidenceSummary) return;
    setError(null);
    setLoading(true);
    try {
      const nextRoundNum = workspace.rounds.length + 1;
      const { round, updatedAgents } = await simulateRound({
        directive: workspace.directive,
        evidenceSummary: workspace.evidenceSummary,
        graph: workspace.graph,
        agents: workspace.agents,
        previousRounds: workspace.rounds,
        roundNumber: nextRoundNum,
        shockInjected: shockText,
      });
      const updated: SimulationWorkspace = {
        ...workspace,
        agents: updatedAgents,
        rounds: [...workspace.rounds, round],
      };
      setWorkspace(updated);
      await persistWorkspace(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunAllRemaining = async () => {
    if (!workspace.graph || !workspace.evidenceSummary) return;
    setError(null);
    setLoading(true);
    let current = workspace;
    try {
      const total = current.directive.roundsCount;
      while (current.rounds.length < total) {
        const nextRoundNum = current.rounds.length + 1;
        const { round, updatedAgents } = await simulateRound({
          directive: current.directive,
          evidenceSummary: current.evidenceSummary!,
          graph: current.graph!,
          agents: current.agents,
          previousRounds: current.rounds,
          roundNumber: nextRoundNum,
        });
        current = {
          ...current,
          agents: updatedAgents,
          rounds: [...current.rounds, round],
        };
        setWorkspace(current);
      }
      await persistWorkspace(current);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!workspace.graph || !workspace.evidenceSummary) return;
    setError(null);
    setLoading(true);
    setWorkspace((prev) => ({ ...prev, currentStep: 4 }));
    try {
      const { report } = await generateReport({
        directive: workspace.directive,
        evidenceSummary: workspace.evidenceSummary,
        graph: workspace.graph,
        agents: workspace.agents,
        rounds: workspace.rounds,
        seeds: workspace.seeds,
      });
      const updated: SimulationWorkspace = {
        ...workspace,
        currentStep: 4,
        report,
      };
      setWorkspace(updated);
      await persistWorkspace(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendChat = async (targetId: string, message: string) => {
    setError(null);
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      senderName: 'You',
      content: message,
      createdAt: new Date().toISOString(),
    };

    const existingHistory = workspace.chatThreads[targetId] || [];
    const withUser: SimulationWorkspace = {
      ...workspace,
      chatThreads: {
        ...workspace.chatThreads,
        [targetId]: [...existingHistory, userMsg],
      },
    };
    setWorkspace(withUser);
    setLoading(true);

    try {
      const targetAgent = workspace.agents.find((a) => a.id === targetId) ?? null;
      const { reply, senderName } = await sendAgentChat({
        directive: workspace.directive,
        evidenceSummary: workspace.evidenceSummary,
        report: workspace.report,
        targetId,
        targetAgent,
        history: existingHistory,
        message,
      });
      const botMsg: ChatMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        senderName,
        content: reply,
        createdAt: new Date().toISOString(),
      };
      const updated: SimulationWorkspace = {
        ...withUser,
        chatThreads: {
          ...withUser.chatThreads,
          [targetId]: [...existingHistory, userMsg, botMsg],
        },
      };
      setWorkspace(updated);
      await persistWorkspace(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await deleteSavedSimulation(id);
      setSavedWorkspaces((prev) => prev.filter((item) => item.id !== id));
      if (workspace.id === id) {
        setWorkspace(createEmptyWorkspace());
      }
    } catch {
      // ignore delete errors
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800/80 bg-[#0E1420]">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleSelectStep(1);
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          MiroFish
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => handleSelectStep(1)}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
              workspace.currentStep === 1 ? 'text-sky-400' : ''
            }`}
          >
            Seed Graph
          </button>
          <button
            type="button"
            disabled={!workspace.graph}
            onClick={() => handleSelectStep(2)}
            className={`hover:text-slate-100 disabled:text-slate-600 transition-colors whitespace-nowrap shrink-0 ${
              workspace.currentStep === 2 ? 'text-sky-400' : ''
            }`}
          >
            Swarm Setup
          </button>
          <button
            type="button"
            disabled={workspace.agents.length === 0}
            onClick={() => handleSelectStep(3)}
            className={`hover:text-slate-100 disabled:text-slate-600 transition-colors whitespace-nowrap shrink-0 ${
              workspace.currentStep === 3 ? 'text-sky-400' : ''
            }`}
          >
            Simulation
          </button>
          <button
            type="button"
            disabled={workspace.rounds.length === 0 && !workspace.report}
            onClick={() => handleSelectStep(4)}
            className={`hover:text-slate-100 disabled:text-slate-600 transition-colors whitespace-nowrap shrink-0 ${
              workspace.currentStep === 4 ? 'text-sky-400' : ''
            }`}
          >
            Forecast Report
          </button>
          <button
            type="button"
            disabled={!workspace.graph}
            onClick={() => handleSelectStep(5)}
            className={`hover:text-slate-100 disabled:text-slate-600 transition-colors whitespace-nowrap shrink-0 ${
              workspace.currentStep === 5 ? 'text-sky-400' : ''
            }`}
          >
            Agent Chat
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleNewPrediction}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-500 rounded-md hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
          >
            New Prediction
          </button>
        </div>
      </header>

      {/* Main Command Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <HistoryRail
          activeWorkspace={workspace}
          savedWorkspaces={savedWorkspaces}
          proxyStatus={proxyStatus}
          onSelectStep={handleSelectStep}
          onLoadWorkspace={(loaded) => {
            setError(null);
            setWorkspace(loaded);
          }}
          onDeleteWorkspace={handleDeleteSaved}
        />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-[1160px] mx-auto">
            {workspace.currentStep === 1 && (
              <Step1SeedGraph
                workspace={workspace}
                proxyStatus={proxyStatus}
                loading={loading}
                error={error}
                onChangeWorkspace={setWorkspace}
                onBuildGraph={handleBuildGraph}
                onProceedToSwarm={handleProceedToSwarm}
              />
            )}

            {workspace.currentStep === 2 && (
              <Step2EnvSetup
                workspace={workspace}
                loading={loading}
                error={error}
                onChangeWorkspace={setWorkspace}
                onRegeneratePersonas={handleRegeneratePersonas}
                onLaunchSimulation={() => handleSelectStep(3)}
              />
            )}

            {workspace.currentStep === 3 && (
              <Step3Simulation
                workspace={workspace}
                running={loading}
                error={error}
                onRunNextRound={handleRunRound}
                onRunAllRemaining={handleRunAllRemaining}
                onResetRounds={() =>
                  setWorkspace((prev) => ({
                    ...prev,
                    rounds: [],
                    report: null,
                  }))
                }
                onGenerateReport={handleGenerateReport}
              />
            )}

            {workspace.currentStep === 4 && (
              <Step4Report
                workspace={workspace}
                loading={loading}
                error={error}
                onRegenerateReport={handleGenerateReport}
                onOpenChat={() => handleSelectStep(5)}
              />
            )}

            {workspace.currentStep === 5 && (
              <Step5Chat
                workspace={workspace}
                sending={loading}
                error={error}
                onSendMessage={handleSendChat}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
