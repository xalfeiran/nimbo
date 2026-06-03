import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  workspacesFileSchema,
  workspaceSchema
} from '../../src/schemas/workspaceSchema';
import type { WorkspaceInput } from '../../src/schemas/workspaceSchema';
import type { Workspace } from '../../src/types/workspace';
import { seedWorkspaces } from './seed';

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
      const parsed = workspacesFileSchema.parse(JSON.parse(raw));
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
    } catch {
      // best-effort
    }
  }

  private persist(workspaces: Workspace[]): Promise<void> {
    const file: WorkspacesFile = { version: 1, workspaces };
    // Chain writes and use atomic rename to avoid partial/corrupt files.
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
      await fs.rename(tmp, this.filePath);
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
