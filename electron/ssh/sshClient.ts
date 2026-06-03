import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, type ConnectConfig } from 'ssh2';
import type { Workspace } from '../../src/types/workspace';
import { KnownHostsStore } from './knownHosts';

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Host-key store, configured once at startup (see configureKnownHosts).
let knownHosts: KnownHostsStore | null = null;

/** Wire up the TOFU host-key store. Call once after the app is ready. */
export function configureKnownHosts(store: KnownHostsStore): void {
  knownHosts = store;
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
 * Host-key verification: trust-on-first-use, persisted via KnownHostsStore
 * (see configureKnownHosts). The first time we see a host we record its key
 * fingerprint; later connections are rejected if the fingerprint changes
 * (possible MITM or a rotated key). This does not yet read the system
 * ~/.ssh/known_hosts or prompt the user on mismatch.
 * ---------------------------------------------------------------------------
 *
 * SECURITY TODO (encrypted keys): passphrase-protected keys are not yet
 * supported. Use an unencrypted key or load it into ssh-agent. A later
 * milestone should prompt for the passphrase and/or pull it from the macOS
 * Keychain (see electron/security/keychain.ts).
 */
export async function buildConnectConfig(workspace: Workspace): Promise<ConnectConfig> {
  const host = workspace.hostname;
  const port = workspace.port || 22;
  const config: ConnectConfig = {
    host,
    port,
    username: workspace.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    // Trust-on-first-use host-key verification. If the store isn't configured
    // (shouldn't happen in the running app) we fail closed and reject.
    hostVerifier: (key: Buffer) =>
      knownHosts ? knownHosts.verify(host, port, key) : false
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
  if (/host key verification|hostkey|host fingerprint/i.test(err.message || '')) {
    return (
      'Host key verification failed: the server presented a different key than ' +
      'the one trusted on first connect. This may be a man-in-the-middle, or the ' +
      "host's key was legitimately rotated. If you trust the change, remove this " +
      "host from the app's known_hosts.json and reconnect."
    );
  }
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
