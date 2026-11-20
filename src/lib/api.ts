import {
  buildEdgeEvidenceAndGraph,
  chatEdgeWithSwarmTarget,
  generateEdgeSwarmPersonas,
  getEdgeProxyStatus,
  runEdgeChainCompletion,
  runEdgeSimulationRound,
  synthesizeEdgePredictionReport,
  testEdgeProviderConnection,
} from './edgeEngine';
import { auth } from './firebase';
import { loadVaultFromStorage } from './vaultClient';
import type {
  AgentPersona,
  ChatMessage,
  EvidenceSummary,
  HopAudit,
  KnowledgeGraph,
  PredictionReport,
  ProxyProviderStatus,
  SeedMaterials,
  SimulationDirective,
  SimulationRound,
  SimulationWorkspace,
  UserVault,
  VaultProviderId,
} from '../types/mirofish';

class StaticProxyUnavailableError extends Error {
  status: number;
  constructor(url: string, status: number) {
    super(`API route ${url} returned non-JSON response (${status}).`);
    this.status = status;
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const customHeaders = new Headers(options?.headers);
  if (!customHeaders.has('Content-Type')) {
    customHeaders.set('Content-Type', 'application/json');
  }
  if (!customHeaders.has('Authorization') && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        customHeaders.set('Authorization', `Bearer ${idToken}`);
      }
    } catch {
      // ignore token retrieval error; backend will enforce 401 if required
    }
  }

  const res = await fetch(url, {
    ...options,
    headers: customHeaders,
  });
  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();

  if (!contentType.includes('application/json')) {
    throw new StaticProxyUnavailableError(url, res.status);
  }

  let data: T & { error?: string | { message?: string } };
  try {
    data = JSON.parse(rawText) as T & { error?: string | { message?: string } };
  } catch {
    throw new StaticProxyUnavailableError(url, res.status);
  }

  if (!res.ok) {
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message || `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }
  return data;
}

function browserOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'https://mirofish.app';
}

export async function syncVaultToServer(vault: UserVault): Promise<{ ok: boolean; updatedAt: string }> {
  try {
    return await requestJson('/api/vault/sync', {
      method: 'POST',
      body: JSON.stringify(vault),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return { ok: true, updatedAt: vault.updatedAt || new Date().toISOString() };
    }
    throw err;
  }
}

export async function testVaultProvider(params: {
  provider: VaultProviderId;
  apiKey: string;
  accountId?: string;
  model?: string;
}): Promise<{ ok: boolean; latencyMs: number; status: number; message: string }> {
  try {
    return await requestJson('/api/vault/test', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return testEdgeProviderConnection({
        ...params,
        isBrowser: true,
        refererOrigin: browserOrigin(),
      });
    }
    throw err;
  }
}

export async function testUnifiedRelayCompletion(params: {
  token: string;
  model: string;
  prompt: string;
  vault?: UserVault;
}): Promise<{
  model: string;
  provider?: string;
  keySlot?: string;
  choices: Array<{ message: { content: string } }>;
  hops?: HopAudit[];
}> {
  try {
    return await requestJson('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: 'user', content: params.prompt }],
        max_tokens: 200,
        stream: false,
        ...(params.vault ? { vault: params.vault } : {}),
      }),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      const vault = params.vault ?? loadVaultFromStorage();
      const res = await runEdgeChainCompletion({
        vault,
        messages: [{ role: 'user', content: params.prompt }],
        preferredModel: params.model || 'freeflow',
        maxTokens: 200,
        isBrowser: true,
        refererOrigin: browserOrigin(),
      });
      return {
        model: res.modelUsed,
        provider: res.providerUsed,
        keySlot: res.keySlotUsed,
        choices: [{ message: { content: res.text } }],
        hops: res.hops,
      };
    }
    throw err;
  }
}

export async function fetchProxyStatus(): Promise<ProxyProviderStatus> {
  try {
    return await requestJson<ProxyProviderStatus>('/api/proxy/status');
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return getEdgeProxyStatus(loadVaultFromStorage());
    }
    throw err;
  }
}

export async function extractKnowledgeGraph(
  directive: SimulationDirective,
  seeds: SeedMaterials,
  vault?: UserVault
): Promise<{ evidenceSummary: EvidenceSummary; graph: KnowledgeGraph; cached: boolean }> {
  try {
    return await requestJson('/api/proxy/graph', {
      method: 'POST',
      body: JSON.stringify({ directive, seeds, vault }),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return buildEdgeEvidenceAndGraph(directive, seeds, vault ?? loadVaultFromStorage(), {
        isBrowser: true,
        refererOrigin: browserOrigin(),
      });
    }
    throw err;
  }
}

export async function generatePersonas(
  directive: SimulationDirective,
  evidenceSummary: EvidenceSummary,
  graph: KnowledgeGraph,
  vault?: UserVault
): Promise<{ agents: AgentPersona[] }> {
  try {
    return await requestJson('/api/proxy/personas', {
      method: 'POST',
      body: JSON.stringify({ directive, evidenceSummary, graph, vault }),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      const agents = await generateEdgeSwarmPersonas(
        directive,
        evidenceSummary,
        graph,
        vault ?? loadVaultFromStorage(),
        { isBrowser: true, refererOrigin: browserOrigin() }
      );
      return { agents };
    }
    throw err;
  }
}

export async function simulateRound(params: {
  directive: SimulationDirective;
  evidenceSummary: EvidenceSummary;
  graph: KnowledgeGraph;
  agents: AgentPersona[];
  previousRounds: SimulationRound[];
  roundNumber: number;
  shockInjected?: string;
  vault?: UserVault;
}): Promise<{ round: SimulationRound; updatedAgents: AgentPersona[] }> {
  try {
    return await requestJson('/api/proxy/simulate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return runEdgeSimulationRound({
        ...params,
        vault: params.vault ?? loadVaultFromStorage(),
        isBrowser: true,
        refererOrigin: browserOrigin(),
      });
    }
    throw err;
  }
}

export async function generateReport(params: {
  directive: SimulationDirective;
  evidenceSummary: EvidenceSummary;
  graph: KnowledgeGraph;
  agents: AgentPersona[];
  rounds: SimulationRound[];
  seeds: SeedMaterials;
  vault?: UserVault;
}): Promise<{ report: PredictionReport }> {
  try {
    return await requestJson('/api/proxy/report', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      const report = await synthesizeEdgePredictionReport({
        ...params,
        vault: params.vault ?? loadVaultFromStorage(),
        isBrowser: true,
        refererOrigin: browserOrigin(),
      });
      return { report };
    }
    throw err;
  }
}

export async function sendAgentChat(params: {
  directive: SimulationDirective;
  evidenceSummary: EvidenceSummary | null;
  report: PredictionReport | null;
  targetId: string;
  targetAgent: AgentPersona | null;
  history: ChatMessage[];
  message: string;
  vault?: UserVault;
}): Promise<{ reply: string; senderName: string }> {
  try {
    return await requestJson('/api/proxy/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return chatEdgeWithSwarmTarget({
        ...params,
        vault: params.vault ?? loadVaultFromStorage(),
        isBrowser: true,
        refererOrigin: browserOrigin(),
      });
    }
    throw err;
  }
}

export async function listSavedSimulations(): Promise<{ simulations: SimulationWorkspace[] }> {
  try {
    return await requestJson('/api/simulations');
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return { simulations: [] };
    }
    throw err;
  }
}

export async function saveSimulationWorkspace(
  workspace: SimulationWorkspace
): Promise<{ simulation: SimulationWorkspace }> {
  try {
    return await requestJson('/api/simulations', {
      method: 'POST',
      body: JSON.stringify(workspace),
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return { simulation: workspace };
    }
    throw err;
  }
}

export async function deleteSavedSimulation(id: string): Promise<{ deleted: boolean }> {
  try {
    return await requestJson(`/api/simulations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    if (err instanceof StaticProxyUnavailableError) {
      return { deleted: true };
    }
    throw err;
  }
}

export interface PromptPreset {
  id: string;
  label: string;
  domainHint: string;
  horizon: string;
  prompt: string;
  sampleText: string;
}

export const UNIVERSAL_PRESETS: PromptPreset[] = [
  {
    id: 'market-catalyst',
    label: 'Market & Macro Catalyst',
    domainHint: 'Macro & Financial Markets',
    horizon: 'Next 14 trading days',
    prompt:
      'Based on the attached chart images, price structure, and macro news context, forecast the primary directional bias, key inflection levels, and probability of continuation vs. reversal.',
    sampleText:
      'Central bank minutes indicate cautious data-dependency while inflation expectations remain slightly elevated. Market positioning shows crowded momentum ahead of upcoming labor and CPI releases.',
  },
  {
    id: 'policy-regulation',
    label: 'Policy & Regulation',
    domainHint: 'Public Policy & Governance',
    horizon: 'Next 6 months',
    prompt:
      'Predict how major industry stakeholders, regulators, and public sentiment will respond if this policy proposal is enacted, and estimate the likelihood of amendment or passage.',
    sampleText:
      'Draft regulatory framework proposes mandatory transparency audits for automated decision systems alongside phased compliance timelines for small enterprises.',
  },
  {
    id: 'public-opinion',
    label: 'Public Opinion Evolution',
    domainHint: 'Social & Media Dynamics',
    horizon: 'Next 30 days',
    prompt:
      'Simulate how public discourse, media narratives, and coalition sentiment will evolve over the next 30 days following this announcement, identifying tipping points.',
    sampleText:
      'Initial social reaction is polarized between privacy advocates demanding immediate rollbacks and institutional supporters emphasizing safety metrics.',
  },
  {
    id: 'product-launch',
    label: 'Product & Market Adoption',
    domainHint: 'Technology & Strategy',
    horizon: 'Next 2 quarters',
    prompt:
      'Forecast enterprise and consumer adoption trajectory, likely competitor counter-moves, and pricing resistance over the next two quarters.',
    sampleText:
      'New developer platform launches with aggressive usage-based pricing, undercut by legacy incumbents bundling enterprise compliance SLAs.',
  },
];

export function createEmptyWorkspace(): SimulationWorkspace {
  const now = new Date().toISOString();
  return {
    id: `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: 'Untitled Forecast',
    createdAt: now,
    updatedAt: now,
    currentStep: 1,
    directive: {
      prompt: '',
      horizon: 'Next 30 days',
      domainHint: 'Universal',
      groundingEnabled: true,
      routingMode: 'freeflow-chain',
      roundsCount: 4,
    },
    seeds: {
      textInputs: [],
      urls: [],
      images: [],
    },
    evidenceSummary: null,
    graph: null,
    agents: [],
    rounds: [],
    report: null,
    chatThreads: {},
  };
}
