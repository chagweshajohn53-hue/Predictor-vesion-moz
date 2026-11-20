import type { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  ChainModelConfig,
  RoutingMode,
  SimulationWorkspace,
  UserVault,
  VaultProviderId,
} from '../types/mirofish';
import { OperationType, db, handleFirestoreError } from './firebase';
import { DEFAULT_CHAIN, generateVaultToken } from './vaultClient';

const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const VALID_PROVIDERS: VaultProviderId[] = [
  'gemini',
  'groq',
  'grok',
  'openrouter',
  'cloudflare',
  'anthropic',
];
const VALID_ROUTING_MODES: RoutingMode[] = [
  'freeflow-chain',
  'anthropic-specialist',
  'hybrid-ensemble',
];

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned && ID_REGEX.test(cleaned)
    ? cleaned
    : `${fallbackPrefix}_${Date.now()}`;
}

function stripUndefined<T>(value: T): T {
  if (value === undefined) return null as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = stripUndefined(v);
    }
  }
  return out as T;
}

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string' && value) {
    return value;
  }
  return new Date().toISOString();
}

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const displayName = (user.displayName || user.email?.split('@')[0] || 'MiroFish Analyst').slice(
    0,
    120
  );
  const photoURL = (user.photoURL || '').slice(0, 1000);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    const existing = snap.data();
    if (existing.displayName !== displayName || existing.photoURL !== photoURL) {
      try {
        await updateDoc(userRef, {
          displayName,
          photoURL,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }
  }
}

function sanitizeVaultForFirestore(uid: string, vault: UserVault) {
  const apiToken =
    typeof vault.apiToken === 'string' && /^ffr_[a-zA-Z0-9_-]+$/.test(vault.apiToken)
      ? vault.apiToken.slice(0, 128)
      : generateVaultToken();

  const normSlot = (p: VaultProviderId) => {
    const raw = vault.providers?.[p];
    const backups = [
      String(raw?.backups?.[0] || '').slice(0, 512),
      String(raw?.backups?.[1] || '').slice(0, 512),
      String(raw?.backups?.[2] || '').slice(0, 512),
    ];
    return {
      primary: String(raw?.primary || '').slice(0, 512),
      backups,
    };
  };

  const cfRaw = vault.providers?.cloudflare;
  const cloudflare = {
    ...normSlot('cloudflare'),
    accountId: String(cfRaw?.accountId || '').slice(0, 128),
    backupAccountIds: [
      String(cfRaw?.backupAccountIds?.[0] || '').slice(0, 128),
      String(cfRaw?.backupAccountIds?.[1] || '').slice(0, 128),
      String(cfRaw?.backupAccountIds?.[2] || '').slice(0, 128),
    ],
  };

  const chain: ChainModelConfig[] = (Array.isArray(vault.chain) ? vault.chain : DEFAULT_CHAIN)
    .slice(0, 30)
    .map((entry, idx) => ({
      id: sanitizeId(entry?.id || `c_${idx}`, `c_${idx}`),
      name: String(entry?.name || entry?.model || 'Model').slice(0, 120) || 'Model',
      provider: VALID_PROVIDERS.includes(entry?.provider) ? entry.provider : 'openrouter',
      model: String(entry?.model || 'openrouter/free').slice(0, 160) || 'openrouter/free',
      enabled: Boolean(entry?.enabled),
      timeoutMs: Math.min(180000, Math.max(1000, Math.round(Number(entry?.timeoutMs) || 30000))),
      supportsVision: Boolean(entry?.supportsVision),
    }));

  return {
    ownerId: uid,
    apiToken,
    providers: {
      gemini: normSlot('gemini'),
      groq: normSlot('groq'),
      grok: normSlot('grok'),
      openrouter: normSlot('openrouter'),
      cloudflare,
      anthropic: normSlot('anthropic'),
    },
    chain,
  };
}

export async function loadVaultFromFirestore(uid: string): Promise<UserVault | null> {
  const path = `users/${uid}/private/vault`;
  const vaultRef = doc(db, 'users', uid, 'private', 'vault');
  try {
    const snap = await getDoc(vaultRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    const cf = data.providers?.cloudflare;
    return {
      apiToken: String(data.apiToken || generateVaultToken()),
      providers: {
        gemini: data.providers?.gemini || { primary: '', backups: ['', '', ''] },
        groq: data.providers?.groq || { primary: '', backups: ['', '', ''] },
        grok: data.providers?.grok || { primary: '', backups: ['', '', ''] },
        openrouter: data.providers?.openrouter || { primary: '', backups: ['', '', ''] },
        cloudflare: {
          primary: String(cf?.primary || ''),
          backups: [cf?.backups?.[0] || '', cf?.backups?.[1] || '', cf?.backups?.[2] || ''],
          accountId: String(cf?.accountId || ''),
          backupAccountIds: [
            cf?.backupAccountIds?.[0] || '',
            cf?.backupAccountIds?.[1] || '',
            cf?.backupAccountIds?.[2] || '',
          ],
        },
        anthropic: data.providers?.anthropic || { primary: '', backups: ['', '', ''] },
      },
      chain:
        Array.isArray(data.chain) && data.chain.length > 0
          ? (data.chain as ChainModelConfig[])
          : DEFAULT_CHAIN,
      updatedAt: timestampToIso(data.updatedAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveVaultToFirestore(uid: string, vault: UserVault): Promise<void> {
  const path = `users/${uid}/private/vault`;
  const vaultRef = doc(db, 'users', uid, 'private', 'vault');
  const sanitized = sanitizeVaultForFirestore(uid, vault);

  let snap;
  try {
    snap = await getDoc(vaultRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(vaultRef, {
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(vaultRef, {
        apiToken: sanitized.apiToken,
        providers: sanitized.providers,
        chain: sanitized.chain,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

function sanitizeSimulationForFirestore(uid: string, ws: SimulationWorkspace) {
  const id = sanitizeId(ws.id, 'sim');
  const routingMode: RoutingMode = VALID_ROUTING_MODES.includes(ws.directive?.routingMode)
    ? ws.directive.routingMode
    : 'freeflow-chain';

  const currentStep = Math.min(6, Math.max(1, Math.round(Number(ws.currentStep) || 1)));
  const roundsCount = Math.min(12, Math.max(1, Math.round(Number(ws.directive?.roundsCount) || 3)));

  const textInputs = (Array.isArray(ws.seeds?.textInputs) ? ws.seeds.textInputs : [])
    .slice(0, 10)
    .map((t) => String(t || '').slice(0, 50000));

  const urls = (Array.isArray(ws.seeds?.urls) ? ws.seeds.urls : [])
    .slice(0, 20)
    .map((u) => String(u || '').slice(0, 2000));

  // Strip multi-MB base64Data before saving to Firestore to respect the 1MB doc limit
  const images = (Array.isArray(ws.seeds?.images) ? ws.seeds.images : [])
    .slice(0, 6)
    .map((img, i) => ({
      id: sanitizeId(img?.id || `img_${i}`, `img_${i}`),
      name: String(img?.name || 'image').slice(0, 240),
      mimeType: String(img?.mimeType || 'image/png').slice(0, 80),
      sizeBytes: Math.max(0, Math.round(Number(img?.sizeBytes) || 0)),
    }));

  const chatEntries = Object.entries(ws.chatThreads || {}).slice(0, 30);
  const chatThreads = Object.fromEntries(
    chatEntries.map(([k, msgs]) => [k, stripUndefined(Array.isArray(msgs) ? msgs.slice(-40) : [])])
  );

  return {
    id,
    ownerId: uid,
    title: String(ws.title || 'Untitled Forecast').slice(0, 200) || 'Untitled Forecast',
    currentStep,
    directive: {
      prompt: String(ws.directive?.prompt || '').slice(0, 10000),
      horizon: String(ws.directive?.horizon || '').slice(0, 200),
      domainHint: String(ws.directive?.domainHint || '').slice(0, 200),
      groundingEnabled: Boolean(ws.directive?.groundingEnabled),
      routingMode,
      roundsCount,
    },
    seeds: {
      textInputs,
      urls,
      images,
    },
    evidenceSummary: ws.evidenceSummary ? stripUndefined(ws.evidenceSummary) : null,
    graph: ws.graph ? stripUndefined(ws.graph) : null,
    agents: stripUndefined(Array.isArray(ws.agents) ? ws.agents.slice(0, 24) : []),
    rounds: stripUndefined(Array.isArray(ws.rounds) ? ws.rounds.slice(0, 20) : []),
    report: ws.report ? stripUndefined(ws.report) : null,
    chatThreads,
  };
}

export async function saveSimulationToFirestore(
  uid: string,
  workspace: SimulationWorkspace
): Promise<void> {
  const payload = sanitizeSimulationForFirestore(uid, workspace);
  const path = `users/${uid}/simulations/${payload.id}`;
  const simRef = doc(db, 'users', uid, 'simulations', payload.id);

  let snap;
  try {
    snap = await getDoc(simRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(simRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(simRef, {
        title: payload.title,
        currentStep: payload.currentStep,
        directive: payload.directive,
        seeds: payload.seeds,
        evidenceSummary: payload.evidenceSummary,
        graph: payload.graph,
        agents: payload.agents,
        rounds: payload.rounds,
        report: payload.report,
        chatThreads: payload.chatThreads,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function deleteSimulationFromFirestore(
  uid: string,
  simulationId: string
): Promise<void> {
  const safeId = sanitizeId(simulationId, 'sim');
  const path = `users/${uid}/simulations/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'simulations', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserSimulations(
  uid: string,
  onSimulations: (simulations: SimulationWorkspace[]) => void
): Unsubscribe {
  const path = `users/${uid}/simulations`;
  const q = query(collection(db, 'users', uid, 'simulations'), where('ownerId', '==', uid), limit(50));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SimulationWorkspace[] = snapshot.docs.map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id || d.id),
          title: String(raw.title || 'Untitled Forecast'),
          createdAt: timestampToIso(raw.createdAt),
          updatedAt: timestampToIso(raw.updatedAt),
          currentStep: (Number(raw.currentStep) || 1) as SimulationWorkspace['currentStep'],
          directive: raw.directive,
          seeds: {
            textInputs: Array.isArray(raw.seeds?.textInputs) ? raw.seeds.textInputs : [],
            urls: Array.isArray(raw.seeds?.urls) ? raw.seeds.urls : [],
            images: Array.isArray(raw.seeds?.images)
              ? raw.seeds.images.map((img: Record<string, unknown>) => ({
                  id: String(img.id || ''),
                  name: String(img.name || 'image'),
                  mimeType: String(img.mimeType || 'image/png'),
                  base64Data: '',
                  sizeBytes: Number(img.sizeBytes) || 0,
                }))
              : [],
          },
          evidenceSummary: raw.evidenceSummary || null,
          graph: raw.graph || null,
          agents: Array.isArray(raw.agents) ? raw.agents : [],
          rounds: Array.isArray(raw.rounds) ? raw.rounds : [],
          report: raw.report || null,
          chatThreads:
            raw.chatThreads && typeof raw.chatThreads === 'object' ? raw.chatThreads : {},
        };
      });
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onSimulations(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
