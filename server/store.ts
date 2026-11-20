import fs from 'fs';
import path from 'path';
import type { SimulationWorkspace } from '../src/types/mirofish.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'simulations.json');

function ensureStore(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

export function listSimulations(): SimulationWorkspace[] {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as SimulationWorkspace[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch {
    return [];
  }
}

export function getSimulation(id: string): SimulationWorkspace | null {
  const all = listSimulations();
  return all.find((item) => item.id === id) ?? null;
}

export function saveSimulation(workspace: SimulationWorkspace): SimulationWorkspace {
  ensureStore();
  const all = listSimulations();
  const now = new Date().toISOString();
  const updated: SimulationWorkspace = {
    ...workspace,
    updatedAt: now,
    createdAt: workspace.createdAt || now,
  };
  const idx = all.findIndex((item) => item.id === updated.id);
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.unshift(updated);
  }
  // Keep up to 40 most recent workspaces to avoid unbounded image payload bloat
  const trimmed = all.slice(0, 40);
  fs.writeFileSync(STORE_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  return updated;
}

export function deleteSimulation(id: string): boolean {
  ensureStore();
  const all = listSimulations();
  const filtered = all.filter((item) => item.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(STORE_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  return true;
}
