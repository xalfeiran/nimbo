import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Workspace, WorkspaceCommand, ServiceCheckResult } from './types/workspace';
import type { WorkspaceInput } from './schemas/workspaceSchema';
import { Sidebar } from './components/Sidebar';
import { WorkspaceDetail } from './components/WorkspaceDetail';
import { WorkspaceForm } from './components/WorkspaceForm';
import { ConfirmModal } from './components/ConfirmModal';
import { TerminalDeck } from './components/TerminalDeck';
import type { OutputState } from './components/OutputPanel';
import type { ConnState } from './components/TerminalPanel';

type FormState = { mode: 'create' } | { mode: 'edit'; workspace: Workspace } | null;
type ConfirmState =
  | { kind: 'command'; workspaceId: string; command: WorkspaceCommand }
  | { kind: 'delete'; workspace: Workspace }
  | null;

let tabCounter = 0;
const makeTabId = (workspaceId: string) =>
  `${workspaceId}#${Date.now().toString(36)}${(tabCounter++).toString(36)}`;

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Terminal tabs (multiple SSH connections per workspace).
  const [tabs, setTabs] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const [connStatus, setConnStatus] = useState<Record<string, ConnState>>({});
  const [pendingByTab, setPendingByTab] = useState<Record<string, string | null>>({});

  // Output-mode command results + service checks (per workspace).
  const [outputs, setOutputs] = useState<Record<string, OutputState | null>>({});
  const [checkResults, setCheckResults] = useState<Record<string, Record<string, ServiceCheckResult>>>({});
  const [checksRunning, setChecksRunning] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState<FormState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // Portal targets for the persistent terminal deck. `termMount` is the slot in
  // the selected workspace's detail view; `fallback` is an always-mounted
  // hidden node that keeps sessions alive when no slot is visible.
  const [termMount, setTermMount] = useState<HTMLDivElement | null>(null);
  const [fallback, setFallback] = useState<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => workspaces.find((w) => w.id === selectedId) ?? null,
    [workspaces, selectedId]
  );

  // ---- initial load ----
  const reload = useCallback(async (preferId?: string) => {
    try {
      const list = await window.nimbo.listWorkspaces();
      setWorkspaces(list);
      setSelectedId((current) => {
        if (preferId && list.some((w) => w.id === preferId)) return preferId;
        if (current && list.some((w) => w.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ---- workspace CRUD ----
  const handleSave = async (input: WorkspaceInput) => {
    if (form?.mode === 'edit') {
      const updated = await window.nimbo.updateWorkspace(form.workspace.id, input);
      await reload(updated.id);
    } else {
      const created = await window.nimbo.createWorkspace(input);
      await reload(created.id);
    }
    setForm(null);
  };

  const handleDuplicate = async (workspace: Workspace) => {
    const { id: _id, ...rest } = workspace;
    const created = await window.nimbo.createWorkspace({
      ...rest,
      name: `${workspace.name} (copy)`
    });
    await reload(created.id);
  };

  const performDelete = async (workspace: Workspace) => {
    await window.nimbo.deleteWorkspace(workspace.id);
    setTabs((t) => {
      const next = { ...t };
      delete next[workspace.id];
      return next;
    });
    setConfirm(null);
    await reload();
  };

  // ---- terminal tabs ----
  const openShell = useCallback((workspaceId: string): string => {
    const tabId = makeTabId(workspaceId);
    setTabs((t) => ({ ...t, [workspaceId]: [...(t[workspaceId] ?? []), tabId] }));
    setActiveTab((a) => ({ ...a, [workspaceId]: tabId }));
    return tabId;
  }, []);

  const closeTab = useCallback((workspaceId: string, tabId: string) => {
    setTabs((t) => {
      const list = (t[workspaceId] ?? []).filter((x) => x !== tabId);
      return { ...t, [workspaceId]: list };
    });
    setConnStatus((s) => {
      const next = { ...s };
      delete next[tabId];
      return next;
    });
    setPendingByTab((m) => {
      const next = { ...m };
      delete next[tabId];
      return next;
    });
  }, []);

  // ---- commands ----
  const runCommand = useCallback(
    (workspaceId: string, command: WorkspaceCommand) => {
      if (command.mode === 'terminal') {
        // Send into the active shell, opening a new one if none exists.
        const existing = activeTab[workspaceId];
        const list = tabs[workspaceId] ?? [];
        const tabId = existing && list.includes(existing) ? existing : openShell(workspaceId);
        setPendingByTab((m) => ({ ...m, [tabId]: command.command }));
      } else {
        setOutputs((m) => ({
          ...m,
          [workspaceId]: { commandName: command.name, running: true }
        }));
        void window.nimbo
          .runCommand(workspaceId, command.command)
          .then((result) =>
            setOutputs((m) => ({
              ...m,
              [workspaceId]: { commandName: command.name, running: false, result }
            }))
          )
          .catch((err: Error) =>
            setOutputs((m) => ({
              ...m,
              [workspaceId]: {
                commandName: command.name,
                running: false,
                result: { stdout: '', stderr: '', exitCode: null, error: err.message }
              }
            }))
          );
      }
    },
    [activeTab, tabs, openShell]
  );

  const handleRunCommand = (command: WorkspaceCommand) => {
    if (!selected) return;
    if (command.confirm || command.dangerous) {
      setConfirm({ kind: 'command', workspaceId: selected.id, command });
    } else {
      runCommand(selected.id, command);
    }
  };

  // ---- service checks ----
  const refreshChecks = useCallback(async (workspaceId: string) => {
    setChecksRunning((m) => ({ ...m, [workspaceId]: true }));
    try {
      const results = await window.nimbo.runChecks(workspaceId);
      const byId: Record<string, ServiceCheckResult> = {};
      for (const r of results) byId[r.id] = r;
      setCheckResults((m) => ({ ...m, [workspaceId]: byId }));
    } finally {
      setChecksRunning((m) => ({ ...m, [workspaceId]: false }));
    }
  }, []);

  const handleTabStatus = useCallback(
    (tabId: string, state: ConnState) => {
      setConnStatus((s) => (s[tabId] === state ? s : { ...s, [tabId]: state }));
      // On a successful connect, auto-refresh that workspace's service checks.
      // TerminalPanel reports 'connected' exactly once per session.
      if (state === 'connected') {
        const workspaceId = tabId.split('#')[0];
        void refreshChecks(workspaceId);
      }
    },
    [refreshChecks]
  );

  // Which workspaces have at least one connected session (for the green dot).
  const connectedByWs = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const [wsId, list] of Object.entries(tabs)) {
      map[wsId] = list.some((tid) => connStatus[tid] === 'connected');
    }
    return map;
  }, [tabs, connStatus]);

  if (loadError) {
    return (
      <div className="app" style={{ gridTemplateColumns: '1fr' }}>
        <div className="main">
          <div className="main__placeholder">
            <div>Failed to load workspaces.</div>
            <div style={{ color: 'var(--red)' }}>{loadError}</div>
          </div>
        </div>
      </div>
    );
  }

  // Effective tab data for the selected workspace.
  const wsTabs = selected ? tabs[selected.id] ?? [] : [];
  const effectiveActive =
    selected && wsTabs.length
      ? activeTab[selected.id] && wsTabs.includes(activeTab[selected.id])
        ? activeTab[selected.id]
        : wsTabs[wsTabs.length - 1]
      : undefined;

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: collapsed ? '0px 1fr' : '248px 1fr' }}
    >
      <Sidebar
        workspaces={workspaces}
        selectedId={selectedId}
        connectedByWs={connectedByWs}
        onSelect={setSelectedId}
        onAdd={() => setForm({ mode: 'create' })}
        onCollapse={() => setCollapsed(true)}
      />

      <main className="main">
        {selected ? (
          <WorkspaceDetail
            workspace={selected}
            sidebarCollapsed={collapsed}
            onExpandSidebar={() => setCollapsed(false)}
            tabIds={wsTabs}
            activeTabId={effectiveActive}
            connStatus={connStatus}
            onOpenShell={() => openShell(selected.id)}
            onSelectTab={(tid) => setActiveTab((a) => ({ ...a, [selected.id]: tid }))}
            onCloseTab={(tid) => closeTab(selected.id, tid)}
            onTerminalMount={setTermMount}
            output={outputs[selected.id] ?? null}
            checkResults={checkResults[selected.id] ?? {}}
            checksRunning={!!checksRunning[selected.id]}
            onRunCommand={handleRunCommand}
            onRefreshChecks={() => void refreshChecks(selected.id)}
            onClearOutput={() => setOutputs((m) => ({ ...m, [selected.id]: null }))}
            onEdit={() => setForm({ mode: 'edit', workspace: selected })}
            onDuplicate={() => void handleDuplicate(selected)}
            onDelete={() => setConfirm({ kind: 'delete', workspace: selected })}
          />
        ) : (
          <div className="main__placeholder">
            {collapsed && (
              <button className="btn btn--sm" onClick={() => setCollapsed(false)}>
                » Show sidebar
              </button>
            )}
            <div>No workspace selected.</div>
            <button className="btn btn--primary" onClick={() => setForm({ mode: 'create' })}>
              + New Workspace
            </button>
          </div>
        )}
      </main>

      {form && (
        <WorkspaceForm
          workspace={form.mode === 'edit' ? form.workspace : undefined}
          onSave={handleSave}
          onCancel={() => setForm(null)}
        />
      )}

      {confirm?.kind === 'command' && (
        <ConfirmModal
          title="Run dangerous command?"
          danger
          confirmLabel="Run command"
          message={`"${confirm.command.name}" is marked dangerous. This will run on ${
            workspaces.find((w) => w.id === confirm.workspaceId)?.name ?? 'the server'
          }:`}
          command={confirm.command.command}
          onConfirm={() => {
            runCommand(confirm.workspaceId, confirm.command);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.kind === 'delete' && (
        <ConfirmModal
          title="Delete workspace?"
          danger
          confirmLabel="Delete"
          message={`Delete "${confirm.workspace.name}"? This removes its saved config locally. It cannot be undone.`}
          onConfirm={() => void performDelete(confirm.workspace)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Persistent terminal sessions: rendered once, portaled into the active
          workspace's slot. Keeps SSH connections alive across switches. */}
      <div ref={setFallback} style={{ display: 'none' }} />
      <TerminalDeck
        target={termMount ?? fallback}
        tabs={tabs}
        selectedId={selectedId}
        activeTabId={effectiveActive}
        pendingByTab={pendingByTab}
        onPendingConsumed={(tid) => setPendingByTab((m) => ({ ...m, [tid]: null }))}
        onTabStatusChange={handleTabStatus}
        onCloseTab={closeTab}
      />
    </div>
  );
}
