import type {
  AgentPersona,
  ChatMessage,
  EvidenceSummary,
  KnowledgeGraph,
  PredictionReport,
  ProxyProviderStatus,
  SeedMaterials,
  SimulationDirective,
  SimulationRound,
  SimulationWorkspace,
} from '../types/mirofish';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export function fetchProxyStatus(): Promise<ProxyProviderStatus> {
  return requestJson<ProxyProviderStatus>('/api/proxy/status');
}

export function extractKnowledgeGraph(
  directive: SimulationDirective,
  seeds: SeedMaterials
): Promise<{ evidenceSummary: EvidenceSummary; graph: KnowledgeGraph; cached: boolean }> {
  return requestJson('/api/proxy/graph', {
    method: 'POST',
    body: JSON.stringify({ directive, seeds }),
  });
}

export function generatePersonas(
  directive: SimulationDirective,
  evidenceSummary: EvidenceSummary,
  graph: KnowledgeGraph
): Promise<{ agents: AgentPersona[] }> {
  return requestJson('/api/proxy/personas', {
    method: 'POST',
    body: JSON.stringify({ directive, evidenceSummary, graph }),
  });
}

export function simulateRound(params: {
  directive: SimulationDirective;
  evidenceSummary: EvidenceSummary;
  graph: KnowledgeGraph;
  agents: AgentPersona[];
  previousRounds: SimulationRound[];
  roundNumber: number;
  shockInjected?: string;
}): Promise<{ round: SimulationRound; updatedAgents: AgentPersona[] }> {
  return requestJson('/api/proxy/simulate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function generateReport(params: {
  directive: SimulationDirective;
  evidenceSummary: EvidenceSummary;
  graph: KnowledgeGraph;
  agents: AgentPersona[];
  rounds: SimulationRound[];
  seeds: SeedMaterials;
}): Promise<{ report: PredictionReport }> {
  return requestJson('/api/proxy/report', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function sendAgentChat(params: {
  directive: SimulationDirective;
  evidenceSummary: EvidenceSummary | null;
  report: PredictionReport | null;
  targetId: string;
  targetAgent: AgentPersona | null;
  history: ChatMessage[];
  message: string;
}): Promise<{ reply: string; senderName: string }> {
  return requestJson('/api/proxy/chat', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function listSavedSimulations(): Promise<{ simulations: SimulationWorkspace[] }> {
  return requestJson('/api/simulations');
}

export function saveSimulationWorkspace(
  workspace: SimulationWorkspace
): Promise<{ simulation: SimulationWorkspace }> {
  return requestJson('/api/simulations', {
    method: 'POST',
    body: JSON.stringify(workspace),
  });
}

export function deleteSavedSimulation(id: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/simulations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
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
