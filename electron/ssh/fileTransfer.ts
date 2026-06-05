import type { Workspace } from '../../src/types/workspace';
import { connect, describeSshError } from './sshClient';

export interface DownloadOutcome {
  /** Absolute remote path that was fetched. */
  remotePath: string;
  /** Bytes written to disk. */
  bytes: number;
}

/**
 * Resolve a user-typed file name into a remote path for SFTP.
 *
 * SFTP resolves relative paths against the connection's start directory (the
 * user's home), so a `~`-based workspace path is normalized to a home-relative
 * one. Absolute names (starting with `/`) are honored as-is. Subpaths like
 * `logs/app.log` are allowed; `..` traversal is rejected to keep downloads
 * scoped to the workspace directory.
 */
export function resolveRemotePath(remotePath: string | undefined, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a file name to download.');
  if (trimmed.split('/').some((seg) => seg === '..')) {
    throw new Error('Path traversal ("..") is not allowed.');
  }

  // Absolute name wins regardless of the workspace path.
  if (trimmed.startsWith('/')) return trimmed;

  // A `~`-relative name is taken relative to home (drop the tilde).
  if (trimmed === '~') return '.';
  if (trimmed.startsWith('~/')) return trimmed.slice(2);

  // Otherwise resolve against the workspace's remote directory.
  let base = (remotePath ?? '').trim();
  if (base === '~') base = '';
  else if (base.startsWith('~/')) base = base.slice(2);
  base = base.replace(/\/+$/, '');

  return base ? `${base}/${trimmed}` : trimmed;
}

/**
 * Download a single remote file over SFTP to a local path. Opens a one-shot
 * SSH connection, fetches the file with `fastGet`, and reports the byte count.
 */
export async function downloadFile(
  workspace: Workspace,
  remoteName: string,
  localPath: string
): Promise<DownloadOutcome> {
  const remotePath = resolveRemotePath(workspace.remotePath, remoteName);

  let client;
  try {
    client = await connect(workspace);
  } catch (err) {
    throw new Error(describeSshError(err as Error));
  }

  try {
    return await new Promise<DownloadOutcome>((resolve, reject) => {
      client!.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`Could not open SFTP channel: ${err.message}`));
          return;
        }
        // Confirm the file exists (and isn't a directory) for a clear error.
        sftp.stat(remotePath, (statErr, stats) => {
          if (statErr) {
            reject(new Error(`Remote file not found: ${remotePath}`));
            return;
          }
          if (stats.isDirectory()) {
            reject(new Error(`"${remotePath}" is a directory, not a file.`));
            return;
          }
          sftp.fastGet(remotePath, localPath, (getErr) => {
            if (getErr) {
              reject(new Error(`Download failed: ${getErr.message}`));
              return;
            }
            resolve({ remotePath, bytes: stats.size });
          });
        });
      });
    });
  } finally {
    client.end();
  }
}
