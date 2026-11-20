import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  expandVaultPool,
  runChainCompletion,
  testProviderConnection,
  type ChatMsg,
} from './server/modelChain.ts';
import {
  buildEvidenceAndGraph,
  chatWithSwarmTarget,
  generateSwarmPersonas,
  getProxyStatus,
  runSimulationRound,
  synthesizePredictionReport,
} from './server/proxyEngine.ts';
import { deleteSimulation, getSimulation, listSimulations, saveSimulation } from './server/store.ts';
import { getVaultByToken, upsertVault } from './server/vaultStore.ts';
import type {
  AgentPersona,
  ChatMessage,
  EvidenceSummary,
  KnowledgeGraph,
  PredictionReport,
  SeedImage,
  SeedMaterials,
  SimulationDirective,
  SimulationRound,
  SimulationWorkspace,
  UserVault,
  VaultProviderId,
} from './src/types/mirofish.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFirebaseProjectId(): string | null {
  try {
    const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
    if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
      return parsed.projectId;
    }
  } catch {
    // ignore missing/malformed config
  }
  return null;
}

const firebaseProjectId = loadFirebaseProjectId();
const adminAuth = firebaseProjectId
  ? getAuth(getApps().length ? getApp() : initializeApp({ projectId: firebaseProjectId }))
  : null;

async function verifyBearerFirebaseToken(req: express.Request): Promise<{ uid: string; emailVerified: boolean } | null> {
  if (!adminAuth) return null;
  const authHeader = req.headers.authorization;
  const match = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(\S+)$/i) : null;
  const token = match?.[1];
  if (!token || token.startsWith('ffr_')) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

async function requireFirebaseAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  const verified = await verifyBearerFirebaseToken(req);
  if (!verified) {
    res.status(401).json({ error: 'Authentication required. Please sign in to access this workspace.' });
    return;
  }
  if (!verified.emailVerified) {
    res.status(403).json({ error: 'Verified email required.' });
    return;
  }
  next();
}

const ALLOWED_RELAY_HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'openrouter.ai',
  'api.cloudflare.com',
  'api.anthropic.com',
]);

function resolveVaultFromRequest(req: express.Request): UserVault | null {
  const bodyVault = (req.body as { vault?: UserVault } | undefined)?.vault;
  if (bodyVault?.apiToken) return bodyVault;
  const authMatch = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
  if (authMatch?.[1]) {
    return getVaultByToken(authMatch[1]);
  }
  return null;
}

function normalizeImageInput(raw: unknown): SeedImage[] {
  if (!Array.isArray(raw)) return [];
  const out: SeedImage[] = [];
  raw.forEach((item, idx) => {
    if (typeof item === 'string') {
      const m = item.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      if (m) {
        out.push({ id: `img_${idx}`, name: `image_${idx}`, mimeType: m[1]!, base64Data: m[2]! });
      }
    } else if (item && typeof item === 'object') {
      const obj = item as Partial<SeedImage>;
      if (obj.mimeType && obj.base64Data) {
        out.push({
          id: obj.id || `img_${idx}`,
          name: obj.name || `image_${idx}`,
          mimeType: obj.mimeType,
          base64Data: obj.base64Data,
        });
      }
    }
  });
  return out;
}

async function startServer(): Promise<void> {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  // CORS support for public proxy endpoints
  app.use(['/v1', '/api/public'], (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'authorization, content-type, x-target-url, x-fwd-method, x-fwd-authorization'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Lock internal app API routes behind verified Firebase Auth
  app.use('/api/vault', requireFirebaseAuth);
  app.use('/api/proxy', requireFirebaseAuth);
  app.use('/api/simulations', requireFirebaseAuth);

  // In-App Vault Sync & Live Ping Tester
  app.post('/api/vault/sync', (req, res) => {
    const vault = req.body as UserVault;
    if (!vault?.apiToken || !vault.apiToken.startsWith('ffr_')) {
      res.status(400).json({ error: 'Valid ffr_* vault token required.' });
      return;
    }
    const saved = upsertVault(vault);
    res.json({ ok: true, updatedAt: saved.updatedAt });
  });

  app.post('/api/vault/test', async (req, res) => {
    const { provider, apiKey, accountId, model } = req.body as {
      provider?: VaultProviderId;
      apiKey?: string;
      accountId?: string;
      model?: string;
    };
    if (!provider || !apiKey?.trim()) {
      res.status(400).json({ ok: false, latencyMs: 0, status: 400, message: 'Provider and API key required.' });
      return;
    }
    const result = await testProviderConnection({
      provider,
      apiKey: apiKey.trim(),
      accountId: accountId?.trim(),
      model,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // Stateless Allowlisted Relay Endpoint (/api/public/relay)
  app.post('/api/public/relay', async (req, res) => {
    const authHeader = req.headers.authorization;
    const ffrMatch = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(ffr_\S+)$/i) : null;
    const validFfrVault = ffrMatch?.[1] ? getVaultByToken(ffrMatch[1]) : null;
    const validFirebase = validFfrVault ? null : await verifyBearerFirebaseToken(req);
    if (!validFfrVault && !validFirebase?.emailVerified) {
      res.status(401).json({ error: 'Authentication required (Firebase ID token or valid ffr_* vault token).' });
      return;
    }

    const headerTarget = req.headers['x-target-url'];
    const targetUrl =
      typeof headerTarget === 'string' && headerTarget
        ? headerTarget
        : (req.body as { targetUrl?: string })?.targetUrl;

    if (!targetUrl) {
      res.status(400).json({ error: 'Missing targetUrl or x-target-url header.' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      res.status(400).json({ error: 'Invalid target URL.' });
      return;
    }

    if (parsedUrl.protocol !== 'https:' || !ALLOWED_RELAY_HOSTS.has(parsedUrl.hostname)) {
      res.status(403).json({
        error: `Relay blocked: host "${parsedUrl.hostname}" is not in the AI provider allowlist.`,
      });
      return;
    }

    const fwdMethod =
      (typeof req.headers['x-fwd-method'] === 'string' && req.headers['x-fwd-method']) ||
      (req.body as { method?: string })?.method ||
      'POST';
    const fwdAuth =
      typeof req.headers['x-fwd-authorization'] === 'string'
        ? req.headers['x-fwd-authorization']
        : undefined;
    const fwdPayload =
      typeof headerTarget === 'string'
        ? req.body
        : (req.body as { body?: unknown })?.body;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (fwdAuth) headers['authorization'] = fwdAuth;

    try {
      const upstream = await fetch(parsedUrl.toString(), {
        method: fwdMethod.toUpperCase(),
        headers,
        body:
          fwdMethod.toUpperCase() === 'GET' || fwdPayload === undefined
            ? undefined
            : typeof fwdPayload === 'string'
              ? fwdPayload
              : JSON.stringify(fwdPayload),
        signal: AbortSignal.timeout(45_000),
      });
      const text = await upstream.text();
      const ct = upstream.headers.get('content-type') || 'application/json';
      res.status(upstream.status).setHeader('Content-Type', ct).send(text);
    } catch (err) {
      res.status(502).json({ error: `Upstream relay failure: ${(err as Error).message}` });
    }
  });

  // Hosted OpenAI-Compatible Endpoints (/v1/* & /api/public/v1/*)
  const handleListModels = (req: express.Request, res: express.Response) => {
    const authMatch = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!authMatch?.[1]) {
      res.status(401).json({
        error: { message: 'Missing Authorization: Bearer ffr_* token.', type: 'authentication_error', code: 'invalid_api_key' },
      });
      return;
    }
    const vault = getVaultByToken(authMatch[1]);
    if (!vault) {
      res.status(401).json({
        error: { message: 'Vault token not found. Sync your in-app vault first.', type: 'authentication_error', code: 'invalid_api_key' },
      });
      return;
    }
    const pool = expandVaultPool(vault);
    const uniqueModels = Array.from(
      new Map(pool.map((p) => [p.entry.model, p.entry.provider])).entries()
    );
    res.json({
      object: 'list',
      data: [
        { id: 'freeflow', object: 'model', created: 0, owned_by: 'freeflow' },
        ...uniqueModels.map(([id, owner]) => ({
          id,
          object: 'model',
          created: 0,
          owned_by: owner,
        })),
      ],
    });
  };

  const handleChatCompletions = async (req: express.Request, res: express.Response) => {
    const authMatch = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
    const token = authMatch?.[1];
    if (!token) {
      res.status(401).json({
        error: { message: 'Missing Authorization: Bearer ffr_* token.', type: 'authentication_error', code: 'invalid_api_key' },
      });
      return;
    }
    const vault = getVaultByToken(token);
    if (!vault) {
      res.status(401).json({
        error: { message: 'Vault token not recognized. Open Proxy Vault and sync your token.', type: 'authentication_error', code: 'invalid_api_key' },
      });
      return;
    }

    const body = req.body as {
      model?: string;
      messages?: ChatMsg[];
      temperature?: number;
      max_tokens?: number;
      stream?: boolean;
    };
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: { message: 'Invalid chat request: non-empty messages array required.', type: 'invalid_request_error', code: 'invalid_request' },
      });
      return;
    }
    if (body.stream) {
      res.status(400).json({
        error: { message: 'Streaming is not supported on this endpoint. Set stream: false.', type: 'invalid_request_error', code: 'unsupported_value' },
      });
      return;
    }

    try {
      const result = await runChainCompletion({
        vault,
        messages: body.messages,
        preferredModel: body.model || 'freeflow',
        temperature: body.temperature,
        maxTokens: body.max_tokens,
      });
      res.json({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.modelUsed,
        provider: result.providerUsed,
        keySlot: result.keySlotUsed,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result.text },
            finish_reason: 'stop',
          },
        ],
        hops: result.hops,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; hops?: unknown };
      res.status(e.statusCode ?? 503).json({
        error: { message: e.message || 'All pooled providers failed.', type: 'server_error', code: 'providers_unavailable' },
        hops: e.hops || [],
      });
    }
  };

  // Unified Multimodal Endpoint (/api/public/v1/generate)
  const handleUnifiedGenerate = async (req: express.Request, res: express.Response) => {
    const vault = resolveVaultFromRequest(req);
    if (!vault) {
      res.status(401).json({ error: 'Valid Bearer ffr_* token or synced vault required.' });
      return;
    }

    const body = req.body as {
      model?: string;
      prompt?: string;
      messages?: ChatMsg[];
      images?: unknown[];
      temperature?: number;
      max_tokens?: number;
    };

    const messages: ChatMsg[] = Array.isArray(body?.messages) && body.messages.length > 0
      ? body.messages
      : body?.prompt?.trim()
        ? [{ role: 'user', content: body.prompt.trim() }]
        : [];

    if (messages.length === 0) {
      res.status(400).json({ error: 'Provide either prompt or messages.' });
      return;
    }

    const images = normalizeImageInput(body?.images);
    try {
      const result = await runChainCompletion({
        vault,
        messages,
        images,
        preferredModel: body?.model || 'freeflow',
        temperature: body?.temperature,
        maxTokens: body?.max_tokens,
      });
      res.json({
        text: result.text,
        model: result.modelUsed,
        provider: result.providerUsed,
        keySlot: result.keySlotUsed,
        hops: result.hops,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; hops?: unknown };
      res.status(e.statusCode ?? 503).json({
        error: e.message || 'Multimodal failover exhausted.',
        hops: e.hops || [],
      });
    }
  };

  app.get('/v1/models', handleListModels);
  app.get('/api/public/v1/models', handleListModels);
  app.post('/v1/chat/completions', handleChatCompletions);
  app.post('/api/public/v1/chat/completions', handleChatCompletions);
  app.post('/api/public/v1/generate', handleUnifiedGenerate);

  // Proxy Capability Status
  app.get('/api/proxy/status', (req, res) => {
    const vault = resolveVaultFromRequest(req);
    res.json(getProxyStatus(vault));
  });

  // Step 1: Multimodal Evidence Extraction & Knowledge Graph Build
  app.post('/api/proxy/graph', async (req, res) => {
    try {
      const { directive, seeds, vault } = req.body as {
        directive?: SimulationDirective;
        seeds?: SeedMaterials;
        vault?: UserVault;
      };
      if (!directive?.prompt?.trim()) {
        res.status(400).json({ error: 'A prediction prompt is required.' });
        return;
      }
      const safeSeeds: SeedMaterials = {
        textInputs: Array.isArray(seeds?.textInputs) ? seeds.textInputs.filter(Boolean) : [],
        urls: Array.isArray(seeds?.urls) ? seeds.urls.filter(Boolean) : [],
        images: Array.isArray(seeds?.images) ? seeds.images : [],
      };
      const result = await buildEvidenceAndGraph(directive, safeSeeds, vault ?? resolveVaultFromRequest(req));
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      res.status(e.statusCode ?? e.status ?? 500).json({ error: e.message || 'Failed to extract knowledge graph.' });
    }
  });

  // Step 2: Adversarial Swarm Persona Generation
  app.post('/api/proxy/personas', async (req, res) => {
    try {
      const { directive, evidenceSummary, graph, vault } = req.body as {
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
        vault?: UserVault;
      };
      if (!directive?.prompt || !evidenceSummary || !graph) {
        res.status(400).json({ error: 'Directive, evidence summary, and graph are required.' });
        return;
      }
      const agents = await generateSwarmPersonas(directive, evidenceSummary, graph, vault ?? resolveVaultFromRequest(req));
      res.json({ agents });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      res.status(e.statusCode ?? e.status ?? 500).json({ error: e.message || 'Failed to generate swarm personas.' });
    }
  });

  // Step 3: Run Single Swarm Simulation Round
  app.post('/api/proxy/simulate', async (req, res) => {
    try {
      const { directive, evidenceSummary, graph, agents, previousRounds, roundNumber, shockInjected, vault } =
        req.body as {
          directive?: SimulationDirective;
          evidenceSummary?: EvidenceSummary;
          graph?: KnowledgeGraph;
          agents?: AgentPersona[];
          previousRounds?: SimulationRound[];
          roundNumber?: number;
          shockInjected?: string;
          vault?: UserVault;
        };
      if (!directive?.prompt || !evidenceSummary || !graph || !Array.isArray(agents)) {
        res.status(400).json({ error: 'Missing required simulation context.' });
        return;
      }
      const result = await runSimulationRound({
        vault: vault ?? resolveVaultFromRequest(req),
        directive,
        evidenceSummary,
        graph,
        agents,
        previousRounds: previousRounds || [],
        roundNumber: roundNumber || (previousRounds?.length ?? 0) + 1,
        shockInjected,
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      res.status(e.statusCode ?? e.status ?? 500).json({ error: e.message || 'Failed to execute simulation round.' });
    }
  });

  // Step 4: Synthesize Calibrated Prediction Report
  app.post('/api/proxy/report', async (req, res) => {
    try {
      const { directive, evidenceSummary, graph, agents, rounds, seeds, vault } = req.body as {
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
        agents?: AgentPersona[];
        rounds?: SimulationRound[];
        seeds?: SeedMaterials;
        vault?: UserVault;
      };
      if (!directive?.prompt || !evidenceSummary || !graph || !Array.isArray(agents)) {
        res.status(400).json({ error: 'Missing simulation state to synthesize report.' });
        return;
      }
      const report = await synthesizePredictionReport({
        vault: vault ?? resolveVaultFromRequest(req),
        directive,
        evidenceSummary,
        graph,
        agents,
        rounds: rounds || [],
        seeds: seeds || { textInputs: [], urls: [], images: [] },
      });
      res.json({ report });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      res.status(e.statusCode ?? e.status ?? 500).json({ error: e.message || 'Failed to synthesize prediction report.' });
    }
  });

  // Step 5: Deep Interrogation Chat
  app.post('/api/proxy/chat', async (req, res) => {
    try {
      const { directive, evidenceSummary, report, targetId, targetAgent, history, message, vault } =
        req.body as {
          directive?: SimulationDirective;
          evidenceSummary?: EvidenceSummary | null;
          report?: PredictionReport | null;
          targetId?: string;
          targetAgent?: AgentPersona | null;
          history?: ChatMessage[];
          message?: string;
          vault?: UserVault;
        };
      if (!directive?.prompt || !message?.trim()) {
        res.status(400).json({ error: 'Directive and chat message are required.' });
        return;
      }
      const result = await chatWithSwarmTarget({
        vault: vault ?? resolveVaultFromRequest(req),
        directive,
        evidenceSummary: evidenceSummary ?? null,
        report: report ?? null,
        targetId: targetId || 'report_agent',
        targetAgent: targetAgent ?? null,
        history: history || [],
        message: message.trim(),
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      res.status(e.statusCode ?? e.status ?? 500).json({ error: e.message || 'Failed to process agent chat.' });
    }
  });

  // Persistent Workspace Archive Routes
  app.get('/api/simulations', (_req, res) => {
    res.json({ simulations: listSimulations() });
  });

  app.get('/api/simulations/:id', (req, res) => {
    const found = getSimulation(req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Simulation workspace not found.' });
      return;
    }
    res.json({ simulation: found });
  });

  app.post('/api/simulations', (req, res) => {
    const workspace = req.body as SimulationWorkspace;
    if (!workspace?.id) {
      res.status(400).json({ error: 'Invalid simulation payload.' });
      return;
    }
    const saved = saveSimulation(workspace);
    res.json({ simulation: saved });
  });

  app.delete('/api/simulations/:id', (req, res) => {
    const deleted = deleteSimulation(req.params.id);
    res.json({ deleted });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MiroFish Predictor Proxy listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
