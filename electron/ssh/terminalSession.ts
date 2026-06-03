import type { Client, ClientChannel } from 'ssh2';
import type { Workspace } from '../../src/types/workspace';
import { connect, describeSshError } from './sshClient';
import { buildInteractiveBootstrap } from './shellEscape';

interface Session {
  client: Client;
  stream: ClientChannel;
}

export interface TerminalCallbacks {
  onData: (sessionId: string, data: string) => void;
  onExit: (sessionId: string, code: number | null) => void;
  onError: (sessionId: string, message: string) => void;
}

/**
 * Manages interactive SSH shell sessions keyed by a renderer-supplied
 * sessionId. Each session owns one ssh2 Client + one pty shell stream.
 */
export class TerminalSessionManager {
  private sessions = new Map<string, Session>();

  constructor(private readonly cb: TerminalCallbacks) {}

  async open(
    sessionId: string,
    workspace: Workspace,
    cols: number,
    rows: number
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Terminal session "${sessionId}" already open`);
    }

    let client: Client;
    try {
      client = await connect(workspace);
    } catch (err) {
      this.cb.onError(sessionId, describeSshError(err as Error));
      return;
    }

    client.shell(
      { term: 'xterm-256color', cols, rows },
      (err, stream) => {
        if (err) {
          this.cb.onError(sessionId, err.message);
          client.end();
          return;
        }

        this.sessions.set(sessionId, { client, stream });

        stream.on('data', (chunk: Buffer) => {
          this.cb.onData(sessionId, chunk.toString('utf8'));
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          this.cb.onData(sessionId, chunk.toString('utf8'));
        });
        stream.on('close', (code: number | null) => {
          this.cleanup(sessionId);
          this.cb.onExit(sessionId, code ?? null);
        });

        client.on('error', (e) => {
          this.cb.onError(sessionId, describeSshError(e as Error));
        });

        // Bootstrap: cd into the app dir, export env, then replace the shell
        // with a fresh login shell so the user lands in the right context.
        stream.write(buildInteractiveBootstrap(workspace.remotePath, workspace.env));
      }
    );
  }

  input(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.stream.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // setWindow(rows, cols, height, width)
      session.stream.setWindow(rows, cols, 0, 0);
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.stream.end();
      session.client.end();
    } finally {
      this.cleanup(sessionId);
    }
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  private cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
