import fs from 'fs';
import path from 'path';
import type { UserVault } from '../src/types/mirofish.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const VAULT_FILE = path.join(DATA_DIR, 'vaults.json');

function ensureVaultFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(VAULT_FILE)) {
    fs.writeFileSync(VAULT_FILE, JSON.stringify({}, null, 2), 'utf-8');
  }
}

function readAllVaults(): Record<string, UserVault> {
  ensureVaultFile();
  try {
    const raw = fs.readFileSync(VAULT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, UserVault>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getVaultByToken(token: string): UserVault | null {
  if (!token || !token.startsWith('ffr_')) return null;
  const all = readAllVaults();
  return all[token] ?? null;
}

export function upsertVault(vault: UserVault): UserVault {
  ensureVaultFile();
  const all = readAllVaults();
  const normalized: UserVault = {
    ...vault,
    updatedAt: new Date().toISOString(),
  };
  all[normalized.apiToken] = normalized;
  fs.writeFileSync(VAULT_FILE, JSON.stringify(all, null, 2), 'utf-8');
  return normalized;
}
