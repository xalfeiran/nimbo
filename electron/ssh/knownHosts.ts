import { readFileSync, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Trust-on-first-use (TOFU) host-key store.
 *
 * ssh2's `hostVerifier` runs synchronously during the handshake, so we keep
 * the fingerprint map in memory (loaded synchronously at construction) and
 * persist changes asynchronously. The file maps "host:port" to the SHA-256
 * fingerprint of the server's public host key:
 *
 *   - unknown host  -> record the key and accept (first sight),
 *   - known + match -> accept,
 *   - known + diff  -> reject (possible MITM or a legitimately rotated key).
 *
 * This is intentionally simple and self-contained; it does not parse the
 * system ~/.ssh/known_hosts. Removing the "host:port" entry from the JSON
 * file resets trust for that host.
 */
export class KnownHostsStore {
  private readonly filePath: string;
  private hosts: Record<string, string>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'known_hosts.json');
    this.hosts = this.loadSync();
  }

  private loadSync(): Record<string, string> {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { hosts?: Record<string, string> };
      if (parsed && parsed.hosts && typeof parsed.hosts === 'object') {
        return parsed.hosts;
      }
    } catch {
      // Missing or unreadable -> start empty.
    }
    return {};
  }

  private static fingerprint(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * TOFU check. Returns true to accept the connection. Records the key on
   * first sight; rejects on a fingerprint mismatch.
   */
  verify(host: string, port: number, key: Buffer): boolean {
    const id = `${host}:${port}`;
    const fp = KnownHostsStore.fingerprint(key);
    const known = this.hosts[id];
    if (!known) {
      this.hosts[id] = fp;
      this.persist();
      return true;
    }
    return known === fp;
  }

  private persist(): void {
    const data = JSON.stringify({ version: 1, hosts: this.hosts }, null, 2);
    this.writeChain = this.writeChain
      .then(async () => {
        const tmp = `${this.filePath}.tmp`;
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(tmp, data, { mode: 0o600 });
        await fs.chmod(tmp, 0o600).catch(() => {});
        await fs.rename(tmp, this.filePath);
        await fs.chmod(this.filePath, 0o600).catch(() => {});
      })
      .catch(() => {
        // best-effort; a failed persist just means we re-trust next launch
      });
  }
}
