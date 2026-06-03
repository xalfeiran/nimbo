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
