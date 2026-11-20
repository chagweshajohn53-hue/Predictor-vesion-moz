import firebaseConfig from '../../firebase-applet-config.json';
import {
  buildEdgeEvidenceAndGraph,
  chatEdgeWithSwarmTarget,
  expandEdgeVaultPool,
  generateEdgeSwarmPersonas,
  getEdgeProxyStatus,
  runEdgeChainCompletion,
  runEdgeSimulationRound,
  synthesizeEdgePredictionReport,
  testEdgeProviderConnection,
  type EdgeChatMsg,
} from './edgeEngine';
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
} from '../types/mirofish';

const ALLOWED_RELAY_HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.x.ai',
  'openrouter.ai',
  'api.cloudflare.com',
  'api.anthropic.com',
]);

// Edge isolate cache for vaults synced via /api/vault/sync
const isolateVaults = new Map<string, UserVault>();
const verifiedTokenCache = new Map<string, { uid: string; emailVerified: boolean; expiresAt: number }>();

function corsHeaders(isPublic = false): Record<string, string> {
  if (!isPublic) return {};
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, content-type, x-target-url, x-fwd-method, x-fwd-authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

async function readJsonBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function verifyFirebaseIdToken(
  req: Request
): Promise<{ uid: string; emailVerified: boolean } | null> {
  const authHeader = req.headers.get('authorization');
  const match = authHeader?.match(/^Bearer\s+(\S+)$/i);
  const idToken = match?.[1];
  if (!idToken || idToken.startsWith('ffr_')) return null;

  const cached = verifiedTokenCache.get(idToken);
  if (cached && cached.expiresAt > Date.now()) {
    return { uid: cached.uid, emailVerified: cached.emailVerified };
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;

    if (verifiedTokenCache.size > 200) {
      const oldest = verifiedTokenCache.keys().next().value;
      if (oldest) verifiedTokenCache.delete(oldest);
    }
    const result = {
      uid: user.localId,
      emailVerified: Boolean(user.emailVerified),
    };
    verifiedTokenCache.set(idToken, { ...result, expiresAt: Date.now() + 60_000 });
    return result;
  } catch {
    return null;
  }
}

async function requireEdgeFirebaseAuth(req: Request): Promise<Response | null> {
  const verified = await verifyFirebaseIdToken(req);
  if (!verified) {
    return jsonResponse(
      { error: 'Authentication required. Please sign in to access this workspace.' },
      401
    );
  }
  if (!verified.emailVerified) {
    return jsonResponse({ error: 'Verified email required.' }, 403);
  }
  return null;
}

function resolveVault(req: Request, body?: { vault?: UserVault } | null): UserVault | null {
  if (body?.vault?.apiToken) {
    isolateVaults.set(body.vault.apiToken, body.vault);
    return body.vault;
  }
  const authMatch = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
  if (authMatch?.[1]) {
    return isolateVaults.get(authMatch[1]) ?? null;
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

export async function handleEdgeV1Request(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(true);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (
    req.method === 'GET' &&
    (url.pathname === '/v1/models' || url.pathname === '/api/public/v1/models')
  ) {
    const authMatch = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
    if (!authMatch?.[1]) {
      return jsonResponse(
        { error: { message: 'Missing Authorization: Bearer ffr_* token.', type: 'authentication_error', code: 'invalid_api_key' } },
        401,
        cors
      );
    }
    const vault = isolateVaults.get(authMatch[1]);
    if (!vault) {
      return jsonResponse(
        { error: { message: 'Vault token not found in active Edge isolate. Sync your in-app vault first.', type: 'authentication_error', code: 'invalid_api_key' } },
        401,
        cors
      );
    }
    const pool = expandEdgeVaultPool(vault);
    const uniqueModels = Array.from(new Map(pool.map((p) => [p.entry.model, p.entry.provider])).entries());
    return jsonResponse(
      {
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
      },
      200,
      cors
    );
  }

  if (
    req.method === 'POST' &&
    (url.pathname === '/v1/chat/completions' || url.pathname === '/api/public/v1/chat/completions')
  ) {
    const body = await readJsonBody<{
      model?: string;
      messages?: EdgeChatMsg[];
      temperature?: number;
      max_tokens?: number;
      stream?: boolean;
      vault?: UserVault;
    }>(req);

    const authMatch = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
    const token = authMatch?.[1];
    if (!token) {
      return jsonResponse(
        { error: { message: 'Missing Authorization: Bearer ffr_* token.', type: 'authentication_error', code: 'invalid_api_key' } },
        401,
        cors
      );
    }
    const vault = (body?.vault?.apiToken === token ? body.vault : null) ?? isolateVaults.get(token);
    if (!vault) {
      return jsonResponse(
        { error: { message: 'Vault token not recognized in Edge isolate. Open Proxy Vault and sync your token.', type: 'authentication_error', code: 'invalid_api_key' } },
        401,
        cors
      );
    }
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return jsonResponse(
        { error: { message: 'Invalid chat request: non-empty messages array required.', type: 'invalid_request_error', code: 'invalid_request' } },
        400,
        cors
      );
    }
    if (body.stream) {
      return jsonResponse(
        { error: { message: 'Streaming is not supported on this endpoint. Set stream: false.', type: 'invalid_request_error', code: 'unsupported_value' } },
        400,
        cors
      );
    }

    try {
      const result = await runEdgeChainCompletion({
        vault,
        messages: body.messages,
        preferredModel: body.model || 'freeflow',
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        refererOrigin: url.origin,
      });
      return jsonResponse(
        {
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
        },
        200,
        cors
      );
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; hops?: unknown };
      return jsonResponse(
        {
          error: { message: e.message || 'All pooled providers failed.', type: 'server_error', code: 'providers_unavailable' },
          hops: e.hops || [],
        },
        e.statusCode ?? 503,
        cors
      );
    }
  }

  return jsonResponse({ error: 'Not found' }, 404, cors);
}

export async function handleEdgeApiRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/public/')) {
    const cors = corsHeaders(true);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (
      pathname === '/api/public/v1/models' ||
      pathname === '/api/public/v1/chat/completions'
    ) {
      return handleEdgeV1Request(req);
    }

    if (pathname === '/api/public/v1/generate' && req.method === 'POST') {
      const body = await readJsonBody<{
        model?: string;
        prompt?: string;
        messages?: EdgeChatMsg[];
        images?: unknown[];
        temperature?: number;
        max_tokens?: number;
        vault?: UserVault;
      }>(req);
      const vault = resolveVault(req, body);
      if (!vault) {
        return jsonResponse({ error: 'Valid Bearer ffr_* token or synced vault required.' }, 401, cors);
      }
      const messages: EdgeChatMsg[] =
        Array.isArray(body?.messages) && body.messages.length > 0
          ? body.messages
          : body?.prompt?.trim()
            ? [{ role: 'user', content: body.prompt.trim() }]
            : [];
      if (messages.length === 0) {
        return jsonResponse({ error: 'Provide either prompt or messages.' }, 400, cors);
      }
      const images = normalizeImageInput(body?.images);
      try {
        const result = await runEdgeChainCompletion({
          vault,
          messages,
          images,
          preferredModel: body?.model || 'freeflow',
          temperature: body?.temperature,
          maxTokens: body?.max_tokens,
          refererOrigin: url.origin,
        });
        return jsonResponse(
          {
            text: result.text,
            model: result.modelUsed,
            provider: result.providerUsed,
            keySlot: result.keySlotUsed,
            hops: result.hops,
          },
          200,
          cors
        );
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message?: string; hops?: unknown };
        return jsonResponse(
          { error: e.message || 'Multimodal failover exhausted.', hops: e.hops || [] },
          e.statusCode ?? 503,
          cors
        );
      }
    }

    if (pathname === '/api/public/relay' && req.method === 'POST') {
      const authHeader = req.headers.get('authorization');
      const ffrMatch = authHeader?.match(/^Bearer\s+(ffr_\S+)$/i);
      const validFfrVault = ffrMatch?.[1] ? isolateVaults.get(ffrMatch[1]) : null;
      const validFirebase = validFfrVault ? null : await verifyFirebaseIdToken(req);
      if (!validFfrVault && !validFirebase?.emailVerified) {
        return jsonResponse(
          { error: 'Authentication required (Firebase ID token or valid ffr_* vault token).' },
          401,
          cors
        );
      }
      const body = await readJsonBody<{ targetUrl?: string; method?: string; body?: unknown }>(req);
      const headerTarget = req.headers.get('x-target-url');
      const targetUrl = headerTarget || body?.targetUrl;
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing targetUrl or x-target-url header.' }, 400, cors);
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        return jsonResponse({ error: 'Invalid target URL.' }, 400, cors);
      }
      if (parsedUrl.protocol !== 'https:' || !ALLOWED_RELAY_HOSTS.has(parsedUrl.hostname)) {
        return jsonResponse(
          { error: `Relay blocked: host "${parsedUrl.hostname}" is not in the AI provider allowlist.` },
          403,
          cors
        );
      }

      const fwdMethod = req.headers.get('x-fwd-method') || body?.method || 'POST';
      const fwdAuth = req.headers.get('x-fwd-authorization') || undefined;
      const fwdPayload = headerTarget ? body : body?.body;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (fwdAuth) headers.authorization = fwdAuth;

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
        return new Response(text, {
          status: upstream.status,
          headers: { 'Content-Type': ct, ...cors },
        });
      } catch (err) {
        return jsonResponse({ error: `Upstream relay failure: ${(err as Error).message}` }, 502, cors);
      }
    }

    return jsonResponse({ error: 'Public endpoint not found' }, 404, cors);
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // Protected app routes
  if (
    pathname.startsWith('/api/vault') ||
    pathname.startsWith('/api/proxy') ||
    pathname.startsWith('/api/simulations')
  ) {
    const authFail = await requireEdgeFirebaseAuth(req);
    if (authFail) return authFail;
  }

  if (pathname === '/api/vault/sync' && req.method === 'POST') {
    const vault = await readJsonBody<UserVault>(req);
    if (!vault?.apiToken || !vault.apiToken.startsWith('ffr_')) {
      return jsonResponse({ error: 'Valid ffr_* vault token required.' }, 400);
    }
    const updatedAt = vault.updatedAt || new Date().toISOString();
    isolateVaults.set(vault.apiToken, { ...vault, updatedAt });
    return jsonResponse({ ok: true, updatedAt });
  }

  if (pathname === '/api/vault/test' && req.method === 'POST') {
    const body = await readJsonBody<{
      provider?: VaultProviderId;
      apiKey?: string;
      accountId?: string;
      model?: string;
    }>(req);
    if (!body?.provider || !body.apiKey?.trim()) {
      return jsonResponse(
        { ok: false, latencyMs: 0, status: 400, message: 'Provider and API key required.' },
        400
      );
    }
    const result = await testEdgeProviderConnection({
      provider: body.provider,
      apiKey: body.apiKey.trim(),
      accountId: body.accountId?.trim(),
      model: body.model,
      refererOrigin: url.origin,
      isBrowser: false,
    });
    return jsonResponse(result, result.ok ? 200 : 400);
  }

  if (pathname === '/api/proxy/status' && req.method === 'GET') {
    const vault = resolveVault(req);
    return jsonResponse(getEdgeProxyStatus(vault));
  }

  if (pathname === '/api/proxy/graph' && req.method === 'POST') {
    try {
      const body = await readJsonBody<{
        directive?: SimulationDirective;
        seeds?: SeedMaterials;
        vault?: UserVault;
      }>(req);
      if (!body?.directive?.prompt?.trim()) {
        return jsonResponse({ error: 'A prediction prompt is required.' }, 400);
      }
      const safeSeeds: SeedMaterials = {
        textInputs: Array.isArray(body.seeds?.textInputs) ? body.seeds.textInputs.filter(Boolean) : [],
        urls: Array.isArray(body.seeds?.urls) ? body.seeds.urls.filter(Boolean) : [],
        images: Array.isArray(body.seeds?.images) ? body.seeds.images : [],
      };
      const result = await buildEdgeEvidenceAndGraph(
        body.directive,
        safeSeeds,
        resolveVault(req, body),
        { refererOrigin: url.origin }
      );
      return jsonResponse(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      return jsonResponse({ error: e.message || 'Failed to extract knowledge graph.' }, e.statusCode ?? e.status ?? 500);
    }
  }

  if (pathname === '/api/proxy/personas' && req.method === 'POST') {
    try {
      const body = await readJsonBody<{
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
        vault?: UserVault;
      }>(req);
      if (!body?.directive?.prompt || !body.evidenceSummary || !body.graph) {
        return jsonResponse({ error: 'Directive, evidence summary, and graph are required.' }, 400);
      }
      const agents = await generateEdgeSwarmPersonas(
        body.directive,
        body.evidenceSummary,
        body.graph,
        resolveVault(req, body),
        { refererOrigin: url.origin }
      );
      return jsonResponse({ agents });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      return jsonResponse({ error: e.message || 'Failed to generate swarm personas.' }, e.statusCode ?? e.status ?? 500);
    }
  }

  if (pathname === '/api/proxy/simulate' && req.method === 'POST') {
    try {
      const body = await readJsonBody<{
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
        agents?: AgentPersona[];
        previousRounds?: SimulationRound[];
        roundNumber?: number;
        shockInjected?: string;
        vault?: UserVault;
      }>(req);
      if (!body?.directive?.prompt || !body.evidenceSummary || !body.graph || !Array.isArray(body.agents)) {
        return jsonResponse({ error: 'Missing required simulation context.' }, 400);
      }
      const result = await runEdgeSimulationRound({
        vault: resolveVault(req, body),
        directive: body.directive,
        evidenceSummary: body.evidenceSummary,
        graph: body.graph,
        agents: body.agents,
        previousRounds: body.previousRounds || [],
        roundNumber: body.roundNumber || (body.previousRounds?.length ?? 0) + 1,
        shockInjected: body.shockInjected,
        refererOrigin: url.origin,
      });
      return jsonResponse(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      return jsonResponse({ error: e.message || 'Failed to execute simulation round.' }, e.statusCode ?? e.status ?? 500);
    }
  }

  if (pathname === '/api/proxy/report' && req.method === 'POST') {
    try {
      const body = await readJsonBody<{
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary;
        graph?: KnowledgeGraph;
        agents?: AgentPersona[];
        rounds?: SimulationRound[];
        seeds?: SeedMaterials;
        vault?: UserVault;
      }>(req);
      if (!body?.directive?.prompt || !body.evidenceSummary || !body.graph || !Array.isArray(body.agents)) {
        return jsonResponse({ error: 'Missing simulation state to synthesize report.' }, 400);
      }
      const report = await synthesizeEdgePredictionReport({
        vault: resolveVault(req, body),
        directive: body.directive,
        evidenceSummary: body.evidenceSummary,
        graph: body.graph,
        agents: body.agents,
        rounds: body.rounds || [],
        seeds: body.seeds || { textInputs: [], urls: [], images: [] },
        refererOrigin: url.origin,
      });
      return jsonResponse({ report });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      return jsonResponse({ error: e.message || 'Failed to synthesize prediction report.' }, e.statusCode ?? e.status ?? 500);
    }
  }

  if (pathname === '/api/proxy/chat' && req.method === 'POST') {
    try {
      const body = await readJsonBody<{
        directive?: SimulationDirective;
        evidenceSummary?: EvidenceSummary | null;
        report?: PredictionReport | null;
        targetId?: string;
        targetAgent?: AgentPersona | null;
        history?: ChatMessage[];
        message?: string;
        vault?: UserVault;
      }>(req);
      if (!body?.directive?.prompt || !body.message?.trim()) {
        return jsonResponse({ error: 'Directive and chat message are required.' }, 400);
      }
      const result = await chatEdgeWithSwarmTarget({
        vault: resolveVault(req, body),
        directive: body.directive,
        evidenceSummary: body.evidenceSummary ?? null,
        report: body.report ?? null,
        targetId: body.targetId || 'report_agent',
        targetAgent: body.targetAgent ?? null,
        history: body.history || [],
        message: body.message.trim(),
        refererOrigin: url.origin,
      });
      return jsonResponse(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      return jsonResponse({ error: e.message || 'Failed to process agent chat.' }, e.statusCode ?? e.status ?? 500);
    }
  }

  // Stateless Cloudflare Edge handlers for simulation archive (Firestore holds authoritative cloud state)
  if (pathname === '/api/simulations' && req.method === 'GET') {
    return jsonResponse({ simulations: [] });
  }
  if (pathname === '/api/simulations' && req.method === 'POST') {
    const workspace = await readJsonBody<SimulationWorkspace>(req);
    return jsonResponse({ simulation: workspace });
  }
  if (pathname.startsWith('/api/simulations/') && req.method === 'DELETE') {
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: `API route not found: ${pathname}` }, 404);
}
