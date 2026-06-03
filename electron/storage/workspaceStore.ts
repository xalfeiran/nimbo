import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { safeStorage } from 'electron';
import {
  workspacesFileSchema,
  workspaceSchema
} from '../../src/schemas/workspaceSchema';
import type { WorkspaceInput } from '../../src/schemas/workspaceSchema';
import type { Workspace } from '../../src/types/workspace';
import { seedWorkspaces } from './seed';

/** Owner-only read/write — no other local user can read the workspace file. */
const FILE_MODE = 0o600;

/**
 * Marker key for an encrypted env blob on disk. A workspace whose `env` is
 * `{ [ENC_KEY]: "<base64>" }` holds its real env encrypted via Electron
 * safeStorage; we decrypt it back to a plain string map on load.
 */
const ENC_KEY = '__nimbo_enc__';

/**
 * Storage abstraction. The MVP ships a JSON-file implementation; a future
 * SQLite-backed store can implement the same interface with no UI/IPC changes.
 */
export interface WorkspaceStore {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | undefined>;
  create(input: WorkspaceInput): Promise<Workspace>;
  update(id: string, input: WorkspaceInput): Promise<Workspace>;
  remove(id: string): Promise<void>;
}

interface WorkspacesFile {
  version: 1;
  workspaces: Workspace[];
}

export class JsonWorkspaceStore implements WorkspaceStore {
  private readonly filePath: string;
  private cache: Workspace[] | null = null;
  /** Serializes writes so concurrent IPC calls can't clobber the file. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'workspaces.json');
  }

  private async load(): Promise<Workspace[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const decoded = decryptFileEnvs(JSON.parse(raw));
      const parsed = workspacesFileSchema.parse(decoded);
      this.cache = parsed.workspaces;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // First run: seed with example workspaces.
        this.cache = seedWorkspaces();
        await this.persist(this.cache);
      } else {
        // Corrupt or invalid file: back it up and start clean rather than
        // crashing the app.
        await this.backupCorruptFile();
        this.cache = [];
        await this.persist(this.cache);
      }
    }
    return this.cache;
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      const backup = `${this.filePath}.corrupt-${Date.now()}.bak`;
      await fs.rename(this.filePath, backup);
      // Keep the backup owner-only too — it still holds host/user data.
      await fs.chmod(backup, FILE_MODE).catch(() => {});
    } catch {
      // best-effort
    }
  }

  private persist(workspaces: Workspace[]): Promise<void> {
    // Encrypt env secrets in the on-disk copy; the in-memory cache stays plain.
    const file: WorkspacesFile = {
      version: 1,
      workspaces: workspaces.map(encryptWorkspaceEnv) as Workspace[]
    };
    // Chain writes and use atomic rename to avoid partial/corrupt files.
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      // mode on writeFile is masked by umask; chmod afterwards to be sure.
      await fs.writeFile(tmp, JSON.stringify(file, null, 2), { mode: FILE_MODE });
      await fs.chmod(tmp, FILE_MODE).catch(() => {});
      await fs.rename(tmp, this.filePath);
      await fs.chmod(this.filePath, FILE_MODE).catch(() => {});
    });
    return this.writeChain;
  }

  async list(): Promise<Workspace[]> {
    return [...(await this.load())];
  }

  async get(id: string): Promise<Workspace | undefined> {
    return (await this.load()).find((w) => w.id === id);
  }

  async create(input: WorkspaceInput): Promise<Workspace> {
    const workspaces = await this.load();
    const workspace = workspaceSchema.parse({
      ...input,
      id: input.id && input.id.length > 0 ? input.id : randomUUID()
    });
    if (workspaces.some((w) => w.id === workspace.id)) {
      throw new Error(`Workspace id "${workspace.id}" already exists`);
    }
    workspaces.push(workspace);
    await this.persist(workspaces);
    return workspace;
  }

  async update(id: string, input: WorkspaceInput): Promise<Workspace> {
    const workspaces = await this.load();
    const idx = workspaces.findIndex((w) => w.id === id);
    if (idx === -1) throw new Error(`Workspace "${id}" not found`);
    const workspace = workspaceSchema.parse({ ...input, id });
    workspaces[idx] = workspace;
    await this.persist(workspaces);
    return workspace;
  }

  async remove(id: string): Promise<void> {
    const workspaces = await this.load();
    const next = workspaces.filter((w) => w.id !== id);
    if (next.length === workspaces.length) {
      throw new Error(`Workspace "${id}" not found`);
    }
    this.cache = next;
    await this.persist(next);
  }
}

// ---- env encryption at rest ----------------------------------------------
//
// `env` often holds secrets (API keys, DB passwords). We encrypt the env map
// with Electron safeStorage (OS-backed: Keychain on macOS, libsecret/DPAPI
// elsewhere) before it touches disk, and decrypt on load. Everything else in
// the workspace is non-secret connection metadata and stays readable.

/** True when the OS provides a backing store for safeStorage. */
function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Return a disk-form copy of a workspace with its env encrypted (if possible). */
function encryptWorkspaceEnv(workspace: Workspace): Workspace {
  const env = workspace.env;
  if (!env || Object.keys(env).length === 0) return workspace;
  // Already an encrypted envelope? Leave as-is.
  if (ENC_KEY in env) return workspace;
  if (!canEncrypt()) return workspace; // fall back to plaintext (still 0600)
  const blob = safeStorage.encryptString(JSON.stringify(env)).toString('base64');
  return { ...workspace, env: { [ENC_KEY]: blob } };
}

/**
 * Walk a parsed-from-disk file object and turn any encrypted env envelopes
 * back into plain string maps, in place. Plaintext envs (legacy files, or
 * platforms without safeStorage) pass through untouched.
 */
function decryptFileEnvs(fileObj: unknown): unknown {
  if (
    !fileObj ||
    typeof fileObj !== 'object' ||
    !Array.isArray((fileObj as { workspaces?: unknown }).workspaces)
  ) {
    return fileObj;
  }
  const workspaces = (fileObj as { workspaces: unknown[] }).workspaces;
  for (const w of workspaces) {
    if (!w || typeof w !== 'object') continue;
    const env = (w as { env?: unknown }).env;
    if (!env || typeof env !== 'object') continue;
    const blob = (env as Record<string, unknown>)[ENC_KEY];
    if (typeof blob !== 'string') continue; // plaintext env, leave it
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(blob, 'base64'));
      (w as { env: unknown }).env = JSON.parse(decrypted);
    } catch {
      // Can't decrypt (e.g. different machine/user): drop the env rather than
      // leaking the ciphertext into the app as a bogus variable.
      delete (w as { env?: unknown }).env;
    }
  }
  return fileObj;
}
