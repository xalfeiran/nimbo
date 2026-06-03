import type { Workspace, CommandResult, ServiceCheck, ServiceCheckResult } from '../../src/types/workspace';
import { connect, describeSshError } from './sshClient';
import { buildOutputCommand, quotePath } from './shellEscape';

const EXEC_TIMEOUT_MS = 30000;

/**
 * Run a single command over a one-shot SSH connection and capture its output.
 * Used for "output" mode commands. Wraps the command with cd + env exports.
 */
export async function runOutputCommand(
  workspace: Workspace,
  rawCommand: string
): Promise<CommandResult> {
  const wrapped = buildOutputCommand(rawCommand, workspace.remotePath, workspace.env);
  try {
    return await execOnce(workspace, wrapped);
  } catch (err) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      error: describeSshError(err as Error)
    };
  }
}

/**
 * Run all service checks for a workspace over a single shared SSH connection
 * (cheaper than one connection per check).
 */
export async function runServiceChecks(
  workspace: Workspace,
  checks: ServiceCheck[]
): Promise<ServiceCheckResult[]> {
  if (checks.length === 0) return [];

  let client;
  try {
    client = await connect(workspace);
  } catch (err) {
    // Whole connection failed: every check is in error.
    const message = describeSshError(err as Error);
    return checks.map((c) => ({
      id: c.id,
      status: 'error' as const,
      output: '',
      expected: c.expected,
      error: message
    }));
  }

  try {
    const results: ServiceCheckResult[] = [];
    for (const check of checks) {
      // Service checks are read-only status probes; run them directly in the
      // remote path so relative commands behave, but env is rarely needed.
      const wrapped = workspace.remotePath
        ? `cd ${quotePath(workspace.remotePath)} >/dev/null 2>&1; ${check.command}`
        : check.command;
      try {
        const res = await execOnClient(client, wrapped);
        const output = (res.stdout + res.stderr).trim();
        const matches = output.toLowerCase() === check.expected.trim().toLowerCase();
        results.push({
          id: check.id,
          status: matches ? 'healthy' : 'unhealthy',
          output,
          expected: check.expected
        });
      } catch (err) {
        results.push({
          id: check.id,
          status: 'error',
          output: '',
          expected: check.expected,
          error: (err as Error).message
        });
      }
    }
    return results;
  } finally {
    client.end();
  }
}

// ---- internals -----------------------------------------------------------

function execOnce(workspace: Workspace, command: string): Promise<CommandResult> {
  return new Promise(async (resolve, reject) => {
    let client;
    try {
      client = await connect(workspace);
    } catch (err) {
      reject(err);
      return;
    }
    try {
      const result = await execOnClient(client, command);
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      client.end();
    }
  });
}

function execOnClient(
  client: import('ssh2').Client,
  command: string
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Command timed out after ${EXEC_TIMEOUT_MS / 1000}s`));
    }, EXEC_TIMEOUT_MS);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;

      stream
        .on('close', (code: number | null) => {
          if (timedOut) return;
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code ?? exitCode });
        })
        .on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        })
        .on('exit', (code: number | null) => {
          exitCode = code;
        });
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
    });
  });
}
