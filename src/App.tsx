import { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { useFirebase } from './components/FirebaseProvider';
import { HistoryRail } from './components/HistoryRail';
import { ProxyVaultView } from './components/ProxyVaultView';
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
  syncVaultToServer,
} from './lib/api';
import {
  deleteSimulationFromFirestore,
  loadVaultFromFirestore,
  saveSimulationToFirestore,
  saveVaultToFirestore,
  subscribeToUserSimulations,
} from './lib/firebaseStore';
import { loadVaultFromStorage, saveVaultToStorage } from './lib/vaultClient';
import type {
  ChatMessage,
  ProxyProviderStatus,
  SimulationStep,
  SimulationWorkspace,
  UserVault,
  VaultProviderId,
} from './types/mirofish';

const LOCAL_ARCHIVE_KEY = 'mirofish_saved_workspaces_v1';

function readLocalArchive(): SimulationWorkspace[] {
  try {
    const raw = localStorage.getItem(LOCAL_ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SimulationWorkspace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalArchive(list: SimulationWorkspace[]): void {
  try {
    localStorage.setItem(LOCAL_ARCHIVE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // ignore storage quota errors
  }
}

function normalizeWorkspace(raw: SimulationWorkspace): SimulationWorkspace {
  const fallback = createEmptyWorkspace();
  return {
    ...fallback,
    ...raw,
    directive: {
      ...fallback.directive,
      ...(raw.directive || {}),
    },
    seeds: {
      textInputs: Array.isArray(raw.seeds?.textInputs) ? raw.seeds.textInputs : [],
      urls: Array.isArray(raw.seeds?.urls) ? raw.seeds.urls : [],
      images: Array.isArray(raw.seeds?.images) ? raw.seeds.images : [],
    },
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    rounds: Array.isArray(raw.rounds) ? raw.rounds : [],
    chatThreads: raw.chatThreads && typeof raw.chatThreads === 'object' ? raw.chatThreads : {},
  };
}

function mergeVaultWithLocal(local: UserVault, cloud: UserVault | null): { merged: UserVault; needsCloudUpload: boolean } {
  if (!cloud) {
    return { merged: local, needsCloudUpload: true };
  }
  const providerIds: VaultProviderId[] = ['gemini', 'groq', 'openrouter', 'cloudflare', 'anthropic'];
  let needsCloudUpload = false;
  const mergedProviders = { ...cloud.providers };

  for (const pid of providerIds) {
    const cloudSlot = cloud.providers[pid];
    const localSlot = local.providers[pid];
    const cloudHasKeys = Boolean(cloudSlot?.primary?.trim() || cloudSlot?.backups?.some((b) => b.trim()));
    const localHasKeys = Boolean(localSlot?.primary?.trim() || localSlot?.backups?.some((b) => b.trim()));
    if (!cloudHasKeys && localHasKeys) {
      mergedProviders[pid] = { ...localSlot };
      needsCloudUpload = true;
    }
  }

  return {
    merged: {
      ...cloud,
      providers: mergedProviders,
    },
    needsCloudUpload,
  };
}

export default function App() {
  const { user, authReady, signingIn, authError, signIn, signOut } = useFirebase();
  const [workspace, setWorkspace] = useState<SimulationWorkspace>(() => createEmptyWorkspace());
  const [savedWorkspaces, setSavedWorkspaces] = useState<SimulationWorkspace[]>(() =>
    readLocalArchive()
  );
  const [vault, setVault] = useState<UserVault>(() => loadVaultFromStorage());
  const [vaultSyncStatus, setVaultSyncStatus] = useState<'idle' | 'saving' | 'synced' | 'error'>('idle');
  const [cloudVaultStatus, setCloudVaultStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [proxyStatus, setProxyStatus] = useState<ProxyProviderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const syncVault = useCallback(
    async (targetVault: UserVault) => {
      setVaultSyncStatus('saving');
      try {
        await syncVaultToServer(targetVault);
        setVaultSyncStatus('synced');
      } catch {
        setVaultSyncStatus('error');
      }

      if (user) {
        setCloudVaultStatus('saving');
        try {
          await saveVaultToFirestore(user.uid, targetVault);
          setCloudVaultStatus('saved');
        } catch {
          setCloudVaultStatus('error');
        }
      }
    },
    [user]
  );

  useEffect(() => {
    syncVaultToServer(vault)
      .then(() => setVaultSyncStatus('synced'))
      .catch(() => setVaultSyncStatus('error'));

    fetchProxyStatus()
      .then((status) => {
        if (status && typeof status.geminiConfigured === 'boolean') {
          setProxyStatus(status);
        } else {
          setProxyStatus(null);
        }
      })
      .catch(() => setProxyStatus(null));

    listSavedSimulations()
      .then((res) => {
        if (Array.isArray(res?.simulations) && !user) {
          const normalized = res.simulations.map(normalizeWorkspace);
          setSavedWorkspaces(normalized);
          writeLocalArchive(normalized);
        }
      })
      .catch(() => {
        if (!user) {
          setSavedWorkspaces(readLocalArchive());
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync Vault and Simulations with Firebase Firestore when authenticated
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setCloudVaultStatus('idle');
      return;
    }

    let cancelled = false;
    setCloudVaultStatus('saving');
    loadVaultFromFirestore(user.uid)
      .then(async (cloudVault) => {
        if (cancelled) return;
        const localCurrent = loadVaultFromStorage();
        const { merged, needsCloudUpload } = mergeVaultWithLocal(localCurrent, cloudVault);
        setVault(merged);
        saveVaultToStorage(merged);
        syncVaultToServer(merged)
          .then(() => setVaultSyncStatus('synced'))
          .catch(() => setVaultSyncStatus('error'));

        if (needsCloudUpload) {
          await saveVaultToFirestore(user.uid, merged);
        }
        if (!cancelled) {
          setCloudVaultStatus('saved');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCloudVaultStatus('error');
          setError((err as Error).message);
        }
      });

    const unsubscribe = subscribeToUserSimulations(user.uid, (cloudList) => {
      const localMap = new Map(readLocalArchive().map((item) => [item.id, item]));
      const mergedList = cloudList.map((item) => {
        const localMatch = localMap.get(item.id);
        if (localMatch && localMatch.seeds?.images?.some((img) => img.base64Data)) {
          return normalizeWorkspace({
            ...item,
            seeds: {
              ...item.seeds,
              images: item.seeds.images.map((img) => {
                const fullImg = localMatch.seeds.images.find((li) => li.id === img.id);
                return fullImg?.base64Data ? { ...img, base64Data: fullImg.base64Data } : img;
              }),
            },
          });
        }
        return normalizeWorkspace(item);
      });
      setSavedWorkspaces(mergedList);
      writeLocalArchive(mergedList);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authReady, user]);

  const handleUpdateVault = useCallback(
    (updater: (prev: UserVault) => UserVault) => {
      setVault((prev) => {
        const next = { ...updater(prev), updatedAt: new Date().toISOString() };
        saveVaultToStorage(next);
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
          void syncVault(next);
        }, 450);
        return next;
      });
    },
    [syncVault]
  );

  const persistWorkspace = useCallback(
    async (next: SimulationWorkspace) => {
      const normalized = normalizeWorkspace(next);
      setSavedWorkspaces((prev) => {
        const safePrev = Array.isArray(prev) ? prev : [];
        const updatedList = [normalized, ...safePrev.filter((item) => item.id !== normalized.id)];
        writeLocalArchive(updatedList);
        return updatedList;
      });

      if (user) {
        try {
          await saveSimulationToFirestore(user.uid, normalized);
        } catch (err) {
          setError((err as Error).message);
        }
      }

      try {
        const res = await saveSimulationWorkspace(normalized);
        if (res?.simulation?.id && !user) {
          const saved = normalizeWorkspace(res.simulation);
          setSavedWorkspaces((prev) => {
            const safePrev = Array.isArray(prev) ? prev : [];
            const updatedList = [saved, ...safePrev.filter((item) => item.id !== saved.id)];
            writeLocalArchive(updatedList);
            return updatedList;
          });
        }
      } catch {
        // Non-fatal server persistence error; local/Firebase archives remain synced
      }
    },
    [user]
  );

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
        workspace.seeds,
        vault
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
        workspace.graph,
        vault
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
        workspace.graph,
        vault
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
        vault,
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
          vault,
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
        vault,
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
        vault,
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
    setSavedWorkspaces((prev) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const filtered = safePrev.filter((item) => item.id !== id);
      writeLocalArchive(filtered);
      return filtered;
    });
    if (workspace.id === id) {
      setWorkspace(createEmptyWorkspace());
    }
    if (user) {
      try {
        await deleteSimulationFromFirestore(user.uid, id);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    try {
      await deleteSavedSimulation(id);
    } catch {
      // ignore server delete errors when offline/static
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
            Report
          </button>
          <button
            type="button"
            onClick={() => handleSelectStep(6)}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
              workspace.currentStep === 6 ? 'text-sky-400' : ''
            }`}
          >
            Proxy Vault
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300 whitespace-nowrap shrink-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full border border-slate-700"
                  />
                ) : null}
                <span className="max-w-[140px] truncate">{user.displayName || user.email}</span>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                className="px-2.5 py-2 text-xs font-medium text-slate-300 border border-slate-800 bg-[#111827] hover:border-slate-600 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void signIn()}
              className="px-3 py-2 text-xs font-medium text-slate-200 border border-slate-700 bg-[#111827] hover:border-sky-400 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5 text-sky-400" />
              <span>{signingIn ? 'Signing in...' : 'Sign in'}</span>
            </button>
          )}

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
          vault={vault}
          cloudConnected={Boolean(user)}
          onSelectStep={handleSelectStep}
          onLoadWorkspace={(loaded) => {
            setError(null);
            setWorkspace(normalizeWorkspace(loaded));
          }}
          onDeleteWorkspace={handleDeleteSaved}
        />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-[1160px] mx-auto">
            {authError && (
              <div className="mb-4 rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
                {authError}
              </div>
            )}
            {workspace.currentStep === 1 && (
              <Step1SeedGraph
                workspace={workspace}
                proxyStatus={proxyStatus}
                vault={vault}
                loading={loading}
                error={error}
                onChangeWorkspace={setWorkspace}
                onBuildGraph={handleBuildGraph}
                onProceedToSwarm={handleProceedToSwarm}
                onOpenVault={() => handleSelectStep(6)}
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

            {workspace.currentStep === 6 && (
              <ProxyVaultView
                vault={vault}
                syncStatus={vaultSyncStatus}
                cloudConnected={Boolean(user)}
                cloudUserEmail={user?.email || user?.displayName || null}
                cloudStatus={cloudVaultStatus}
                onSignIn={() => void signIn()}
                onUpdateVault={handleUpdateVault}
                onSyncNow={() => syncVault(vault)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
