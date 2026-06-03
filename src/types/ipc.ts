// Shared IPC contract between main and renderer.
// Channel names live here so both sides stay in sync.

import type {
  Workspace,
  ServiceCheck,
  ServiceCheckResult,
  CommandResult,
  WorkspaceCommand
} from './workspace';
import type { WorkspaceInput } from '../schemas/workspaceSchema';

export const IPC = {
  // Workspace CRUD (invoke/handle)
  WORKSPACES_LIST: 'workspaces:list',
  WORKSPACES_CREATE: 'workspaces:create',
  WORKSPACES_UPDATE: 'workspaces:update',
  WORKSPACES_DELETE: 'workspaces:delete',

  // Output-mode command + service checks (invoke/handle)
  COMMAND_RUN: 'command:run',
  CHECKS_RUN: 'checks:run',

  // Interactive terminal (renderer -> main)
  TERM_OPEN: 'term:open',
  TERM_INPUT: 'term:input',
  TERM_RESIZE: 'term:resize',
  TERM_CLOSE: 'term:close',

  // Interactive terminal (main -> renderer, per-session events)
  TERM_DATA: 'term:data',
  TERM_EXIT: 'term:exit',
  TERM_ERROR: 'term:error',

  // Biometric app lock (lock window <-> main)
  AUTH_INFO: 'auth:info',
  AUTH_UNLOCK: 'auth:unlock'
} as const;

// ---- Payloads ------------------------------------------------------------

export interface TermOpenRequest {
  sessionId: string;
  workspaceId: string;
  cols: number;
  rows: number;
}

export interface TermResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TermDataEvent {
  sessionId: string;
  data: string;
}

export interface TermExitEvent {
  sessionId: string;
  code: number | null;
}

export interface TermErrorEvent {
  sessionId: string;
  message: string;
}

export interface RunCommandRequest {
  workspaceId: string;
  command: WorkspaceCommand | { command: string };
}

// ---- Biometric lock ------------------------------------------------------

export interface AuthInfo {
  /** Touch ID is present and usable on this machine. */
  biometricAvailable: boolean;
  /** Human-friendly label for the available method. */
  method: 'touch-id' | 'none';
}

export interface UnlockResult {
  ok: boolean;
  error?: string;
}

// ---- The API surface exposed on window.nimbo -----------------------------

export interface NimboApi {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: WorkspaceInput): Promise<Workspace>;
  updateWorkspace(id: string, input: WorkspaceInput): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  runCommand(workspaceId: string, command: string): Promise<CommandResult>;
  runChecks(workspaceId: string, checks?: ServiceCheck[]): Promise<ServiceCheckResult[]>;

  // Terminal
  openTerminal(req: TermOpenRequest): Promise<void>;
  sendTerminalInput(sessionId: string, data: string): void;
  resizeTerminal(req: TermResizeRequest): void;
  closeTerminal(sessionId: string): void;

  onTerminalData(cb: (e: TermDataEvent) => void): () => void;
  onTerminalExit(cb: (e: TermExitEvent) => void): () => void;
  onTerminalError(cb: (e: TermErrorEvent) => void): () => void;

  // Biometric lock (used by the lock window)
  authInfo(): Promise<AuthInfo>;
  requestUnlock(): Promise<UnlockResult>;
}

declare global {
  interface Window {
    nimbo: NimboApi;
  }
}
