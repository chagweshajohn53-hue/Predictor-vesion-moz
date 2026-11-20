import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_CLAUDE_MODEL,
  isProviderConfigured,
  MODEL_CHAIN,
  runChainCompletion,
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
import type {
  AgentPersona,
  ChatMessage,
  EvidenceSummary,
  KnowledgeGraph,
  PredictionReport,
  SeedMaterials,
  SimulationDirective,
  SimulationRound,
  SimulationWorkspace,
} from './src/types/mirofish.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  // OpenAI-Compatible Proxy Endpoints (/v1/* and /api/public/v1/*) matching Prdictor-op / MIROFISH.md
  function checkFreeflowAuth(req: express.Request): boolean {
    const requiredToken = process.env.FREEFLOW_API_TOKEN;
    if (!requiredToken) return true;
    const match = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
    return match?.[1] === requiredToken;
  }

  const handleListModels = (req: express.Request, res: express.Response) => {
    if (!checkFreeflowAuth(req)) {
      res.status(401).json({
        error: { message: 'Missing or invalid API token', type: 'authentication_error', code: 'invalid_api_key' },
      });
      return;
    }
    const models = [{ id: 'freeflow', object: 'model', created: 0, owned_by: 'freeflow' }];
    if (isProviderConfigured('anthropic')) {
      models.push({ id: DEFAULT_CLAUDE_MODEL, object: 'model', created: 0, owned_by: 'anthropic' });
    }
    for (const entry of MODEL_CHAIN) {
      if (isProviderConfigured(entry.provider)) {
        models.push({ id: entry.model, object: 'model', created: 0, owned_by: entry.provider });
      }
    }
    res.json({ object: 'list', data: models });
  };

  const handleChatCompletions = async (req: express.Request, res: express.Response) => {
    if (!checkFreeflowAuth(req)) {
      res.status(401).json({
        error: { message: 'Missing or invalid API token', type: 'authentication_error', code: 'invalid_api_key' },
      });
      return;
    }
    const body = req.body as {
      model?: string;
      messages?: ChatMsg[];
      stream?: boolean;
    };
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: { message: 'Invalid chat request: messages array required.', type: 'invalid_request_error', code: 'invalid_request' },
      });
      return;
    }
    if (body.stream) {
      res.status(400).json({
        error: { message: 'Streaming is not supported on /v1/chat/completions. Set stream: false.', type: 'invalid_request_error', code: 'unsupported_value' },
      });
      return;
    }

    try {
      const result = await runChainCompletion({
        messages: body.messages,
        preferredModel: body.model || 'freeflow',
      });
      res.json({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.modelUsed,
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
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 503).json({
        error: { message: e.message || 'All configured providers are unavailable.', type: 'server_error', code: 'providers_unavailable' },
      });
    }
  };

  app.get('/v1/models', handleListModels);
  app.get('/api/public/v1/models', handleListModels);
  app.post('/v1/chat/completions', handleChatCompletions);
  app.post('/api/public/v1/chat/completions', handleChatCompletions);

  // Health & Proxy Provider Chain Capability Check (never leaks secrets)
  app.get('/api/proxy/status', (_req, res) => {
    res.json(getProxyStatus());
  });

  // Step 1: Multimodal Evidence Extraction & Knowledge Graph Build
  app.post('/api/proxy/graph', async (req, res) => {
    try {
      const { directive, seeds } = req.body as {
        directive?: SimulationDirective;
        seeds?: SeedMaterials;
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
      const result = await buildEvidenceAndGraph(directive, safeSeeds);
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      const status = e.statusCode ?? e.status ?? 500;
      res.status(status).json({ error: e.message || 'Failed to extract knowledge graph.' });
    }
  });

  // Step 2: Adversarial Swarm Persona Generation
  app.post('/api/proxy/personas', async (req, res) => {
    try {
      const { directive, evidenceSummary, graph } = req.body as {
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
      };
      if (!directive?.prompt || !evidenceSummary || !graph) {
        res.status(400).json({ error: 'Directive, evidence summary, and graph are required.' });
        return;
      }
      const agents = await generateSwarmPersonas(directive, evidenceSummary, graph);
      res.json({ agents });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      const status = e.statusCode ?? e.status ?? 500;
      res.status(status).json({ error: e.message || 'Failed to generate swarm personas.' });
    }
  });

  // Step 3: Run Single Swarm Simulation Round (with optional What-If Shock)
  app.post('/api/proxy/simulate', async (req, res) => {
    try {
      const { directive, evidenceSummary, graph, agents, previousRounds, roundNumber, shockInjected } =
        req.body as {
          directive?: SimulationDirective;
          evidenceSummary?: EvidenceSummary;
          graph?: KnowledgeGraph;
          agents?: AgentPersona[];
          previousRounds?: SimulationRound[];
          roundNumber?: number;
          shockInjected?: string;
        };
      if (!directive?.prompt || !evidenceSummary || !graph || !Array.isArray(agents)) {
        res.status(400).json({ error: 'Missing required simulation context.' });
        return;
      }
      const result = await runSimulationRound({
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
      const status = e.statusCode ?? e.status ?? 500;
      res.status(status).json({ error: e.message || 'Failed to execute simulation round.' });
    }
  });

  // Step 4: Synthesize Calibrated Prediction Report
  app.post('/api/proxy/report', async (req, res) => {
    try {
      const { directive, evidenceSummary, graph, agents, rounds, seeds } = req.body as {
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
        agents?: AgentPersona[];
        rounds?: SimulationRound[];
        seeds?: SeedMaterials;
      };
      if (!directive?.prompt || !evidenceSummary || !graph || !Array.isArray(agents)) {
        res.status(400).json({ error: 'Missing simulation state to synthesize report.' });
        return;
      }
      const report = await synthesizePredictionReport({
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
      const status = e.statusCode ?? e.status ?? 500;
      res.status(status).json({ error: e.message || 'Failed to synthesize prediction report.' });
    }
  });

  // Step 5: Deep Interrogation Chat with ReportAgent or Individual Agent
  app.post('/api/proxy/chat', async (req, res) => {
    try {
      const { directive, evidenceSummary, report, targetId, targetAgent, history, message } =
        req.body as {
          directive?: SimulationDirective;
          evidenceSummary?: EvidenceSummary | null;
          report?: PredictionReport | null;
          targetId?: string;
          targetAgent?: AgentPersona | null;
          history?: ChatMessage[];
          message?: string;
        };
      if (!directive?.prompt || !message?.trim()) {
        res.status(400).json({ error: 'Directive and chat message are required.' });
        return;
      }
      const result = await chatWithSwarmTarget({
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
      const status = e.statusCode ?? e.status ?? 500;
      res.status(status).json({ error: e.message || 'Failed to process agent chat.' });
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
