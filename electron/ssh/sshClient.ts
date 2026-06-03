import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, type ConnectConfig } from 'ssh2';
import type { Workspace } from '../../src/types/workspace';

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Build an ssh2 ConnectConfig from a workspace.
 *
 * Auth strategy (MVP): if `identityFile` is set, load that private key.
 * Always also offer the running ssh-agent (via SSH_AUTH_SOCK) as a fallback,
 * which covers keys already loaded in the agent and avoids handling
 * passphrases in this first pass.
 *
 * ---------------------------------------------------------------------------
 * SECURITY TODO (host key verification):
 * For the MVP we accept the server's host key on first sight (TOFU without
 * persistence). This is vulnerable to MITM. A later milestone should:
 *   - read ~/.ssh/known_hosts,
 *   - compare/persist the host key via a real `hostVerifier`,
 *   - prompt the user on first connect / mismatch.
 * ---------------------------------------------------------------------------
 *
 * SECURITY TODO (encrypted keys): passphrase-protected keys are not yet
 * supported. Use an unencrypted key or load it into ssh-agent. A later
 * milestone should prompt for the passphrase and/or pull it from the macOS
 * Keychain (see electron/security/keychain.ts).
 */
export async function buildConnectConfig(workspace: Workspace): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: workspace.hostname,
    port: workspace.port || 22,
    username: workspace.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    // TODO(security): replace with real known_hosts verification.
    hostVerifier: () => true
  };

  // ssh-agent fallback (and primary auth if no identityFile).
  const agentSock = process.env.SSH_AUTH_SOCK;
  if (agentSock) {
    config.agent = agentSock;
  }

  if (workspace.identityFile) {
    const keyPath = expandHome(workspace.identityFile);
    try {
      const key = await fs.readFile(keyPath);
      config.privateKey = key;
    } catch (err) {
      // If the key can't be read but an agent is present, let the agent try.
      if (!agentSock) {
        throw new Error(
          `Could not read SSH key at "${keyPath}": ${(err as Error).message}. ` +
            `No ssh-agent (SSH_AUTH_SOCK) available as a fallback.`
        );
      }
    }
  }

  if (!config.privateKey && !config.agent) {
    throw new Error(
      'No authentication method available: set an identity file on the ' +
        'workspace or start an ssh-agent (SSH_AUTH_SOCK).'
    );
  }

  return config;
}

/**
 * Open an authenticated ssh2 Client for a workspace. The caller is
 * responsible for calling `client.end()` when done (or use a helper that
 * does, like the command runner).
 */
export function connect(workspace: Workspace): Promise<Client> {
  return new Promise(async (resolve, reject) => {
    let config: ConnectConfig;
    try {
      config = await buildConnectConfig(workspace);
    } catch (err) {
      reject(err);
      return;
    }

    const client = new Client();
    let settled = false;

    client.on('ready', () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });

    client.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(describeSshError(err)));
    });

    try {
      client.connect(config);
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}

/** Turn common ssh2 errors into friendlier messages. */
export function describeSshError(err: Error & { level?: string; code?: string }): string {
  const level = err.level;
  if (level === 'client-authentication') {
    return 'Authentication failed. Check the username and SSH key (or ssh-agent).';
  }
  if (err.code === 'ECONNREFUSED') {
    return 'Connection refused. Check the hostname and port.';
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return 'Host not found. Check the hostname.';
  }
  if (err.code === 'ETIMEDOUT' || /timed out/i.test(err.message)) {
    return 'Connection timed out. Check the host, port, and network.';
  }
  return err.message || 'SSH connection error.';
}
