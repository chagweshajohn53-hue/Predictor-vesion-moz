export type VaultProviderId = 'gemini' | 'groq' | 'openrouter' | 'cloudflare' | 'anthropic';

export interface ProviderKeySlot {
  primary: string;
  backups: [string, string, string];
  accountId?: string; // Used by Cloudflare Workers AI
}

export interface ChainModelConfig {
  id: string;
  name: string;
  provider: VaultProviderId;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  supportsVision?: boolean;
}

export interface UserVault {
  apiToken: string; // ffr_* bearer token
  providers: Record<VaultProviderId, ProviderKeySlot>;
  chain: ChainModelConfig[];
  updatedAt: string;
}

export interface HopAudit {
  provider: string;
  model: string;
  keySlot: string;
  latencyMs: number;
  status: number | string;
  ok: boolean;
  error?: string;
}

export type RoutingMode = 'freeflow-chain' | 'anthropic-specialist' | 'hybrid-ensemble';

export type SimulationStep = 1 | 2 | 3 | 4 | 5 | 6; // 6 = Proxy & Vault Manager

export interface SeedImage {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string; // raw base64 without data: prefix
  sizeBytes?: number;
}

export interface SimulationDirective {
  prompt: string;
  horizon: string;
  domainHint: string;
  groundingEnabled: boolean;
  routingMode: RoutingMode;
  roundsCount: number;
}

export interface SeedMaterials {
  textInputs: string[];
  urls: string[];
  images: SeedImage[];
}

export interface GroundedSource {
  title: string;
  uri: string;
}

export interface ExtractedClaim {
  id: string;
  sourceLabel: string;
  claim: string;
  polarity: 'supporting' | 'contradicting' | 'neutral';
  confidence: number;
}

export interface EvidenceSummary {
  brief: string;
  claims: ExtractedClaim[];
  dataGaps: string[];
  groundedSources: GroundedSource[];
  imageInsights: string[];
  imageExtractorModel?: string;
  hops?: HopAudit[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'actor' | 'catalyst' | 'metric' | 'institution' | 'risk' | 'outcome';
  weight: number; // 1 to 10
  summary: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  polarity: 'positive' | 'negative' | 'neutral';
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AgentPersona {
  id: string;
  name: string;
  role: string;
  archetype: string;
  bias: string;
  active: boolean;
  initialConfidence: number; // 0-100
  currentProbability: number; // 0-100
  memory: string[];
}

export interface RoundAgentEntry {
  agentId: string;
  agentName: string;
  role: string;
  stance: 'bullish' | 'bearish' | 'neutral';
  probability: number; // 0-100
  confidence: number; // 0-100
  deltaFromPrevious: number;
  reasoning: string;
  citedClaim: string;
}

export interface SimulationRound {
  roundNumber: number;
  timestamp: string;
  shockInjected?: string;
  consensusProbability: number;
  disagreementIndex: number; // standard deviation 0-50
  summary: string;
  modelUsed?: string;
  hops?: HopAudit[];
  entries: RoundAgentEntry[];
}

export interface ProbabilityOutcome {
  label: string;
  probability: number;
  rationale: string;
}

export interface HorizonStep {
  timeframe: string;
  outlook: string;
  expectedDirection: string;
  keyDriver: string;
}

export interface PredictionReport {
  generatedAt: string;
  engineUsed: string;
  decisionSource: 'claude_final_review' | 'chain_consensus' | 'hybrid_ensemble';
  modelsUsed: string[];
  hops: HopAudit[];
  headlineVerdict: string;
  directAnswer: string;
  confidenceScore: number;
  consensusProbability: number;
  probabilityBreakdown: ProbabilityOutcome[];
  timeHorizonOutlook: HorizonStep[];
  keyCatalysts: string[];
  invalidationTriggers: string[];
  promptComplianceCheck: string;
  methodologyNote: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  senderName: string;
  content: string;
  createdAt: string;
}

export interface SimulationWorkspace {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentStep: SimulationStep;
  directive: SimulationDirective;
  seeds: SeedMaterials;
  evidenceSummary: EvidenceSummary | null;
  graph: KnowledgeGraph | null;
  agents: AgentPersona[];
  rounds: SimulationRound[];
  report: PredictionReport | null;
  chatThreads: Record<string, ChatMessage[]>;
}

export interface ProxyProviderStatus {
  geminiConfigured: boolean;
  geminiModel: string;
  anthropicConfigured: boolean;
  anthropicModel: string;
  groqConfigured: boolean;
  openrouterConfigured: boolean;
  cloudflareConfigured: boolean;
  cacheEntries: number;
}
