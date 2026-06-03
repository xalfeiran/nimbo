import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../src/types/ipc';
import type {
  NimboApi,
  TermOpenRequest,
  TermResizeRequest,
  TermDataEvent,
  TermExitEvent,
  TermErrorEvent
} from '../src/types/ipc';
import type { WorkspaceInput } from '../src/schemas/workspaceSchema';
import type { ServiceCheck } from '../src/types/workspace';

// Helper: subscribe to a main->renderer channel and return an unsubscribe fn.
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: NimboApi = {
  listWorkspaces: () => ipcRenderer.invoke(IPC.WORKSPACES_LIST),
  createWorkspace: (input: WorkspaceInput) =>
    ipcRenderer.invoke(IPC.WORKSPACES_CREATE, input),
  updateWorkspace: (id: string, input: WorkspaceInput) =>
    ipcRenderer.invoke(IPC.WORKSPACES_UPDATE, id, input),
  deleteWorkspace: (id: string) => ipcRenderer.invoke(IPC.WORKSPACES_DELETE, id),

  runCommand: (workspaceId: string, command: string) =>
    ipcRenderer.invoke(IPC.COMMAND_RUN, workspaceId, command),
  runChecks: (workspaceId: string, checks?: ServiceCheck[]) =>
    ipcRenderer.invoke(IPC.CHECKS_RUN, workspaceId, checks),

  openTerminal: (req: TermOpenRequest) => {
    ipcRenderer.send(IPC.TERM_OPEN, req);
    return Promise.resolve();
  },
  sendTerminalInput: (sessionId: string, data: string) =>
    ipcRenderer.send(IPC.TERM_INPUT, sessionId, data),
  resizeTerminal: (req: TermResizeRequest) => ipcRenderer.send(IPC.TERM_RESIZE, req),
  closeTerminal: (sessionId: string) => ipcRenderer.send(IPC.TERM_CLOSE, sessionId),

  onTerminalData: (cb: (e: TermDataEvent) => void) => on(IPC.TERM_DATA, cb),
  onTerminalExit: (cb: (e: TermExitEvent) => void) => on(IPC.TERM_EXIT, cb),
  onTerminalError: (cb: (e: TermErrorEvent) => void) => on(IPC.TERM_ERROR, cb)
};

contextBridge.exposeInMainWorld('nimbo', api);
