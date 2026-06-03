// Core domain types for AppShell.
// These are the single source of truth shared between the Electron main
// process (SSH, storage) and the React renderer (UI).

export type CommandMode = 'terminal' | 'output';

export interface WorkspaceCommand {
  id: string;
  name: string;
  command: string;
  mode: CommandMode;
  /** Mark visually as risky; combine with `confirm` to gate execution. */
  dangerous?: boolean;
  /** Require a confirmation modal before running. */
  confirm?: boolean;
  /** Treat as a log tailer (gets a dedicated "Logs" affordance in the UI). */
  isLog?: boolean;
}

export interface ServiceCheck {
  id: string;
  name: string;
  command: string;
  /** Output is trimmed and compared (case-insensitive) against this value. */
  expected: string;
}

export interface Workspace {
  id: string;
  name: string;
  /** Human-friendly host label, e.g. "Hostinger VPS". Optional. */
  hostLabel?: string;
  hostname: string;
  port: number;
  username: string;
  /** Path to an SSH private key. `~` is expanded at connect time. */
  identityFile?: string;
  /** Remote directory to `cd` into on connect / before commands. */
  remotePath?: string;
  /** App-specific environment variables exported on connect / per command. */
  env?: Record<string, string>;
  commands: WorkspaceCommand[];
  serviceChecks: ServiceCheck[];
}

// ---- Service check results ----------------------------------------------

export type ServiceStatus = 'healthy' | 'unhealthy' | 'unknown' | 'error';

export interface ServiceCheckResult {
  id: string;
  status: ServiceStatus;
  output: string;
  expected: string;
  /** Populated when status is 'error' (e.g. SSH/exec failure). */
  error?: string;
}

// ---- Command (output mode) execution -------------------------------------

export interface CommandResult {
  /** Combined stdout. */
  stdout: string;
  /** Combined stderr. */
  stderr: string;
  /** Remote process exit code, or null if it was killed by a signal. */
  exitCode: number | null;
  /** Populated when the SSH/exec call itself failed. */
  error?: string;
}
