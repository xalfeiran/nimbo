import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export type ConnState = 'connecting' | 'connected' | 'closed' | 'error';

export interface TerminalHandle {
  /** Type a command into the live shell and press enter. */
  runInTerminal: (command: string) => void;
}

interface TerminalPanelProps {
  workspaceId: string;
  /** Stable id for this terminal tab/session. */
  tabId: string;
  /** Whether this tab is the visible one (drives refit/focus). */
  active: boolean;
  /** A command to run once the shell is connected (terminal-mode shortcut). */
  pendingCommand?: string | null;
  onPendingConsumed?: () => void;
  onClose: () => void;
  onStatusChange?: (state: ConnState) => void;
}

function makeSessionId(tabId: string): string {
  return `${tabId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export const TerminalPanel = forwardRef<TerminalHandle, TerminalPanelProps>(
  function TerminalPanel(
    { workspaceId, tabId, active, pendingCommand, onPendingConsumed, onClose, onStatusChange },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const sessionIdRef = useRef<string>(makeSessionId(tabId));
    const connectedRef = useRef(false);
    const statusCbRef = useRef(onStatusChange);
    statusCbRef.current = onStatusChange;
    const [state, setState] = useState<ConnState>('connecting');
    // Bumping this re-runs the session-setup effect, reconnecting the shell.
    const [restartKey, setRestartKey] = useState(0);

    useImperativeHandle(ref, () => ({
      runInTerminal: (command: string) => {
        if (connectedRef.current) {
          window.nimbo.sendTerminalInput(sessionIdRef.current, command + '\n');
          termRef.current?.focus();
        }
      }
    }));

    // Set up xterm + SSH session once per mount (one tab = one session).
    useEffect(() => {
      const sessionId = makeSessionId(tabId);
      sessionIdRef.current = sessionId;
      connectedRef.current = false;
      const report = (s: ConnState) => {
        setState(s);
        statusCbRef.current?.(s);
      };
      report('connecting');

      const term = new Terminal({
        cursorBlink: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 12.5,
        scrollback: 5000,
        theme: {
          background: '#0a0d12',
          foreground: '#d7dde5',
          cursor: '#4c8dff',
          selectionBackground: '#2b3441'
        }
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      fitRef.current = fit;

      if (hostRef.current) {
        term.open(hostRef.current);
        fit.fit();
      }

      const inputDisposable = term.onData((data) => {
        window.nimbo.sendTerminalInput(sessionId, data);
      });

      const offData = window.nimbo.onTerminalData((e) => {
        if (e.sessionId !== sessionId) return;
        if (!connectedRef.current) {
          connectedRef.current = true;
          report('connected');
        }
        term.write(e.data);
      });
      const offExit = window.nimbo.onTerminalExit((e) => {
        if (e.sessionId !== sessionId) return;
        connectedRef.current = false;
        report('closed');
        term.write('\r\n\x1b[38;5;245m[session closed]\x1b[0m\r\n');
      });
      const offError = window.nimbo.onTerminalError((e) => {
        if (e.sessionId !== sessionId) return;
        connectedRef.current = false;
        report('error');
        term.write(`\r\n\x1b[31m[error] ${e.message}\x1b[0m\r\n`);
      });

      void window.nimbo.openTerminal({
        sessionId,
        workspaceId,
        cols: term.cols,
        rows: term.rows
      });

      const resize = () => {
        try {
          fit.fit();
          window.nimbo.resizeTerminal({
            sessionId,
            cols: term.cols,
            rows: term.rows
          });
        } catch {
          /* ignore */
        }
      };
      const ro = new ResizeObserver(resize);
      if (hostRef.current) ro.observe(hostRef.current);

      return () => {
        inputDisposable.dispose();
        offData();
        offExit();
        offError();
        ro.disconnect();
        window.nimbo.closeTerminal(sessionId);
        term.dispose();
        termRef.current = null;
      };
    }, [tabId, workspaceId, restartKey]);

    // Refit + focus when this tab becomes the active/visible one.
    useEffect(() => {
      if (!active) return;
      const id = requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          const term = termRef.current;
          if (term) {
            window.nimbo.resizeTerminal({
              sessionId: sessionIdRef.current,
              cols: term.cols,
              rows: term.rows
            });
            term.focus();
          }
        } catch {
          /* ignore */
        }
      });
      return () => cancelAnimationFrame(id);
    }, [active]);

    // Run a queued terminal-mode command once connected.
    useEffect(() => {
      if (!pendingCommand) return;
      if (state !== 'connected') return;
      window.nimbo.sendTerminalInput(sessionIdRef.current, pendingCommand + '\n');
      termRef.current?.focus();
      onPendingConsumed?.();
    }, [pendingCommand, state, onPendingConsumed]);

    const statusColor =
      state === 'connected'
        ? 'var(--green)'
        : state === 'connecting'
          ? 'var(--amber)'
          : 'var(--red)';

    // The shell is no longer live once it has closed or errored out.
    const canRestart = state === 'closed' || state === 'error';

    return (
      <div className="terminal-wrap">
        <div className="terminal-wrap__bar">
          <span className="terminal-wrap__status">
            <span className="badge__dot" style={{ background: statusColor }} />
            {state}
          </span>
          {canRestart && (
            <button
              className="btn btn--sm"
              onClick={() => setRestartKey((k) => k + 1)}
            >
              Restart session
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            Close shell
          </button>
        </div>
        <div className="terminal-host" ref={hostRef} />
      </div>
    );
  }
);
