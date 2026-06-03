import { useMemo, useState } from 'react';
import type { Workspace, WorkspaceCommand, ServiceCheck, CommandMode } from '../types/workspace';
import { workspaceInputSchema, type WorkspaceInput } from '../schemas/workspaceSchema';

interface WorkspaceFormProps {
  /** Existing workspace when editing; undefined when creating. */
  workspace?: Workspace;
  onSave: (input: WorkspaceInput) => Promise<void> | void;
  onCancel: () => void;
}

let tmpId = 0;
const nextTmpId = (prefix: string) => `${prefix}-${Date.now()}-${tmpId++}`;

function envToText(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

export function WorkspaceForm({ workspace, onSave, onCancel }: WorkspaceFormProps) {
  const [name, setName] = useState(workspace?.name ?? '');
  const [hostLabel, setHostLabel] = useState(workspace?.hostLabel ?? '');
  const [hostname, setHostname] = useState(workspace?.hostname ?? '');
  const [port, setPort] = useState(String(workspace?.port ?? 22));
  const [username, setUsername] = useState(workspace?.username ?? '');
  const [identityFile, setIdentityFile] = useState(workspace?.identityFile ?? '');
  const [remotePath, setRemotePath] = useState(workspace?.remotePath ?? '');
  const [envText, setEnvText] = useState(envToText(workspace?.env));
  const [commands, setCommands] = useState<WorkspaceCommand[]>(
    workspace?.commands ?? []
  );
  const [checks, setChecks] = useState<ServiceCheck[]>(workspace?.serviceChecks ?? []);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!workspace;
  const title = useMemo(() => (isEdit ? 'Edit Workspace' : 'New Workspace'), [isEdit]);

  // ---- command rows ----
  const addCommand = () =>
    setCommands((c) => [
      ...c,
      { id: nextTmpId('cmd'), name: '', command: '', mode: 'output' }
    ]);
  const updateCommand = (id: string, patch: Partial<WorkspaceCommand>) =>
    setCommands((c) => c.map((cmd) => (cmd.id === id ? { ...cmd, ...patch } : cmd)));
  const removeCommand = (id: string) =>
    setCommands((c) => c.filter((cmd) => cmd.id !== id));

  // ---- check rows ----
  const addCheck = () =>
    setChecks((c) => [
      ...c,
      { id: nextTmpId('chk'), name: '', command: '', expected: 'active' }
    ]);
  const updateCheck = (id: string, patch: Partial<ServiceCheck>) =>
    setChecks((c) => c.map((chk) => (chk.id === id ? { ...chk, ...patch } : chk)));
  const removeCheck = (id: string) =>
    setChecks((c) => c.filter((chk) => chk.id !== id));

  const submit = async () => {
    setError(null);
    const candidate = {
      id: workspace?.id,
      name: name.trim(),
      hostLabel: hostLabel.trim() || undefined,
      hostname: hostname.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      identityFile: identityFile.trim() || undefined,
      remotePath: remotePath.trim() || undefined,
      env: textToEnv(envText),
      commands: commands
        .filter((c) => c.name.trim() && c.command.trim())
        .map((c) => ({ ...c, name: c.name.trim(), command: c.command.trim() })),
      serviceChecks: checks
        .filter((c) => c.name.trim() && c.command.trim())
        .map((c) => ({ ...c, name: c.name.trim(), command: c.command.trim() }))
    };
    if (Object.keys(candidate.env).length === 0) delete (candidate as { env?: unknown }).env;

    const parsed = workspaceInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
        </div>
        <div className="modal__body">
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="WebRoster Production" />
            </div>

            <div className="form-row--2">
              <div className="form-row">
                <label className="form-label">Hostname / IP</label>
                <input className="input" value={hostname} onChange={(e) => setHostname(e.target.value)}
                  placeholder="148.72.60.215" />
              </div>
              <div className="form-row">
                <label className="form-label">Port</label>
                <input className="input" value={port} onChange={(e) => setPort(e.target.value)}
                  placeholder="22" />
              </div>
            </div>

            <div className="form-row--2">
              <div className="form-row">
                <label className="form-label">Username</label>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="deploy" />
              </div>
              <div className="form-row">
                <label className="form-label">Host label (optional)</label>
                <input className="input" value={hostLabel} onChange={(e) => setHostLabel(e.target.value)}
                  placeholder="Production VPS" />
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">SSH private key path (optional)</label>
              <input className="input" value={identityFile} onChange={(e) => setIdentityFile(e.target.value)}
                placeholder="~/.ssh/webroster_prod" />
              <span className="form-hint">
                Leave empty to use ssh-agent. Encrypted keys aren't supported yet.
              </span>
            </div>

            <div className="form-row">
              <label className="form-label">Remote app path (optional)</label>
              <input className="input" value={remotePath} onChange={(e) => setRemotePath(e.target.value)}
                placeholder="/var/www/webroster" />
            </div>

            <div className="form-row">
              <label className="form-label">Environment variables (KEY=VALUE per line)</label>
              <textarea className="textarea" value={envText} onChange={(e) => setEnvText(e.target.value)}
                placeholder={'APP_CONTEXT=webroster\nAPP_ENV=production'} />
            </div>

            {/* Commands */}
            <div className="form-row">
              <label className="form-label">Command shortcuts</label>
              {commands.map((cmd) => (
                <div className="subrow" key={cmd.id}>
                  <input className="input" placeholder="Name" value={cmd.name}
                    onChange={(e) => updateCommand(cmd.id, { name: e.target.value })} />
                  <input className="input" placeholder="command" value={cmd.command}
                    onChange={(e) => updateCommand(cmd.id, { command: e.target.value })} />
                  <select className="input" value={cmd.mode}
                    onChange={(e) => updateCommand(cmd.id, { mode: e.target.value as CommandMode })}>
                    <option value="output">output</option>
                    <option value="terminal">terminal</option>
                  </select>
                  <button className="subrow__del" title="Remove" onClick={() => removeCommand(cmd.id)}>×</button>
                  <label className="checkbox-row" style={{ gridColumn: '1 / -1', marginTop: -2 }}>
                    <input type="checkbox" checked={!!cmd.dangerous}
                      onChange={(e) => updateCommand(cmd.id, { dangerous: e.target.checked, confirm: e.target.checked })} />
                    Dangerous (require confirmation)
                    <input type="checkbox" checked={!!cmd.isLog} style={{ marginLeft: 14 }}
                      onChange={(e) => updateCommand(cmd.id, { isLog: e.target.checked })} />
                    Log tailer
                  </label>
                </div>
              ))}
              <button className="btn btn--sm" onClick={addCommand} style={{ marginTop: 4, width: 'fit-content' }}>
                + Add command
              </button>
            </div>

            {/* Service checks */}
            <div className="form-row">
              <label className="form-label">Service checks</label>
              {checks.map((chk) => (
                <div className="subrow subrow--check" key={chk.id}>
                  <input className="input" placeholder="Name" value={chk.name}
                    onChange={(e) => updateCheck(chk.id, { name: e.target.value })} />
                  <input className="input" placeholder="systemctl is-active nginx" value={chk.command}
                    onChange={(e) => updateCheck(chk.id, { command: e.target.value })} />
                  <input className="input" placeholder="expected" value={chk.expected}
                    onChange={(e) => updateCheck(chk.id, { expected: e.target.value })} />
                  <button className="subrow__del" title="Remove" onClick={() => removeCheck(chk.id)}>×</button>
                </div>
              ))}
              <button className="btn btn--sm" onClick={addCheck} style={{ marginTop: 4, width: 'fit-content' }}>
                + Add check
              </button>
            </div>

            {error && <div className="form-error">{error}</div>}
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={submit}>
            {isEdit ? 'Save changes' : 'Create workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
