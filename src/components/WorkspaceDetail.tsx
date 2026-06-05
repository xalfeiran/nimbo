import { useRef, useState } from 'react';
import type { Workspace, WorkspaceCommand } from '../types/workspace';
import type { ServiceCheckResult } from '../types/workspace';
import { CommandButton } from './CommandButton';
import { ServiceChecks } from './ServiceChecks';
import { OutputPanel, type OutputState } from './OutputPanel';
import type { ConnState } from './TerminalPanel';

interface WorkspaceDetailProps {
  workspace: Workspace;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  // Terminal tabs
  tabIds: string[];
  activeTabId?: string;
  connStatus: Record<string, ConnState>;
  onOpenShell: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Receives the DOM node the persistent terminal deck portals into. */
  onTerminalMount: (el: HTMLDivElement | null) => void;
  // Commands / checks / output
  output: OutputState | null;
  checkResults: Record<string, ServiceCheckResult>;
  checksRunning: boolean;
  onRunCommand: (command: WorkspaceCommand) => void;
  onRefreshChecks: () => void;
  onClearOutput: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

type DownloadStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

/** Download a single file from the workspace's remote directory over SFTP. */
function DownloadFile({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<DownloadStatus>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const dir = workspace.remotePath || '~';
  const busy = status.kind === 'busy';

  const close = () => {
    if (busy) return;
    setOpen(false);
    setName('');
    setStatus({ kind: 'idle' });
  };

  const run = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setStatus({ kind: 'busy' });
    try {
      const res = await window.nimbo.downloadFile(workspace.id, trimmed);
      if (res.canceled) {
        setStatus({ kind: 'idle' });
      } else if (res.ok) {
        const size = res.bytes != null ? ` (${formatBytes(res.bytes)})` : '';
        setStatus({ kind: 'ok', message: `Saved to ${res.savedTo}${size}` });
        setName('');
      } else {
        setStatus({ kind: 'error', message: res.error || 'Download failed.' });
      }
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

  // Collapsed: a single button that opens the input, to save vertical space.
  if (!open) {
    return (
      <section>
        <button
          className="btn btn--sm"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          ⬇ Download a File
        </button>
      </section>
    );
  }

  return (
    <section>
      <div className="section__title">Download a File</div>
      <div className="download-row">
        <input
          ref={inputRef}
          className="input download-row__input"
          type="text"
          placeholder="File name (e.g. storage/logs/laravel.log)"
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
            else if (e.key === 'Escape') close();
          }}
        />
        <button
          className="btn btn--primary"
          disabled={busy || !name.trim()}
          onClick={() => void run()}
        >
          {busy ? 'Downloading…' : 'Download'}
        </button>
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
      </div>
      <div className="download-row__hint">
        Resolved relative to <code>{dir}</code>. Use an absolute path (starting
        with <code>/</code>) to download from elsewhere.
      </div>
      {status.kind === 'ok' && (
        <div className="download-row__status download-row__status--ok">
          {status.message}
        </div>
      )}
      {status.kind === 'error' && (
        <div className="download-row__status download-row__status--err">
          {status.message}
        </div>
      )}
    </section>
  );
}

function statusColor(state?: ConnState): string {
  return state === 'connected'
    ? 'var(--green)'
    : state === 'connecting'
      ? 'var(--amber)'
      : state === 'error'
        ? 'var(--red)'
        : 'var(--gray)';
}

export function WorkspaceDetail(props: WorkspaceDetailProps) {
  const {
    workspace,
    sidebarCollapsed,
    onExpandSidebar,
    tabIds,
    activeTabId,
    connStatus,
    onOpenShell,
    onSelectTab,
    onCloseTab,
    onTerminalMount,
    output,
    checkResults,
    checksRunning,
    onRunCommand,
    onRefreshChecks,
    onClearOutput,
    onEdit,
    onDuplicate,
    onDelete
  } = props;

  const envEntries = Object.entries(workspace.env ?? {});

  return (
    <div className="detail">
      <header className="detail__header">
        <div className="detail__titlerow">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {sidebarCollapsed && (
              <button
                className="btn btn--ghost btn--sm"
                title="Expand sidebar"
                onClick={onExpandSidebar}
              >
                »
              </button>
            )}
            <h1 className="detail__title">{workspace.name}</h1>
          </div>
          <div className="actions-row">
            <button className="btn btn--sm" onClick={onEdit}>
              Edit
            </button>
            <button className="btn btn--sm" onClick={onDuplicate}>
              Duplicate
            </button>
            <button className="btn btn--sm btn--danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
        <div className="detail__meta">
          <span>
            <b>Host:</b> {workspace.username}@{workspace.hostname}:{workspace.port}
          </span>
          {workspace.remotePath && (
            <span>
              <b>Path:</b> {workspace.remotePath}
            </span>
          )}
          {envEntries.map(([k, v]) => (
            <span key={k}>
              <b>{k}:</b> {v}
            </span>
          ))}
        </div>
      </header>

      <div className="detail__body">
        {/* Quick actions */}
        <section>
          <div className="section__title">Quick Actions</div>
          <div className="actions-row">
            <button className="btn btn--primary" onClick={onOpenShell}>
              ⌘ Open Shell
            </button>
            {workspace.commands.map((cmd) => (
              <CommandButton key={cmd.id} command={cmd} onRun={onRunCommand} />
            ))}
          </div>
        </section>

        {/* Service checks */}
        <ServiceChecks
          checks={workspace.serviceChecks}
          results={checkResults}
          running={checksRunning}
          onRefresh={onRefreshChecks}
        />

        {/* Download a file from the workspace's remote directory */}
        <DownloadFile workspace={workspace} />

        {/* Output panel (output-mode commands) */}
        {output && <OutputPanel output={output} onClose={onClearOutput} />}

        {/* Terminal: tab bar lives here; the live panels are portaled into the
            mount slot below by the persistent TerminalDeck (so switching never
            reconnects). */}
        <section
          className="detail__terminal"
          style={{ display: tabIds.length > 0 ? 'flex' : 'none' }}
        >
          <div className="section__title">
            <span>Terminal</span>
          </div>
          <div className="term-tabs">
            {tabIds.map((tid, i) => (
              <div
                key={tid}
                className={'term-tab' + (tid === activeTabId ? ' term-tab--active' : '')}
                onClick={() => onSelectTab(tid)}
              >
                <span
                  className="badge__dot"
                  style={{ background: statusColor(connStatus[tid]) }}
                />
                <span>Shell {i + 1}</span>
                <button
                  className="term-tab__close"
                  title="Close connection"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tid);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="term-tab term-tab--add" title="New connection" onClick={onOpenShell}>
              +
            </button>
          </div>
          <div className="terminal-mount" ref={onTerminalMount} />
        </section>
      </div>
    </div>
  );
}
