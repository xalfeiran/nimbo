import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { JsonWorkspaceStore } from './storage/workspaceStore';
import { TerminalSessionManager } from './ssh/terminalSession';
import { runOutputCommand, runServiceChecks } from './ssh/commandRunner';
import { IPC } from '../src/types/ipc';
import type {
  TermOpenRequest,
  TermResizeRequest
} from '../src/types/ipc';
import type { ServiceCheck } from '../src/types/workspace';
import { workspaceInputSchema } from '../src/schemas/workspaceSchema';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let store: JsonWorkspaceStore;
let terminals: TerminalSessionManager;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0e1116',
    title: 'Nimbo',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Open external links in the system browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function registerIpc(): void {
  // ---- Workspace CRUD ----
  ipcMain.handle(IPC.WORKSPACES_LIST, () => store.list());

  ipcMain.handle(IPC.WORKSPACES_CREATE, (_e, input: unknown) => {
    const parsed = workspaceInputSchema.parse(input);
    return store.create(parsed);
  });

  ipcMain.handle(IPC.WORKSPACES_UPDATE, (_e, id: string, input: unknown) => {
    const parsed = workspaceInputSchema.parse(input);
    return store.update(id, parsed);
  });

  ipcMain.handle(IPC.WORKSPACES_DELETE, (_e, id: string) => store.remove(id));

  // ---- Output-mode command ----
  ipcMain.handle(IPC.COMMAND_RUN, async (_e, workspaceId: string, command: string) => {
    const workspace = await store.get(workspaceId);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found`);
    return runOutputCommand(workspace, command);
  });

  // ---- Service checks ----
  ipcMain.handle(
    IPC.CHECKS_RUN,
    async (_e, workspaceId: string, checks?: ServiceCheck[]) => {
      const workspace = await store.get(workspaceId);
      if (!workspace) throw new Error(`Workspace "${workspaceId}" not found`);
      return runServiceChecks(workspace, checks ?? workspace.serviceChecks);
    }
  );

  // ---- Interactive terminal (fire-and-forget from renderer) ----
  ipcMain.on(IPC.TERM_OPEN, async (_e, req: TermOpenRequest) => {
    const workspace = await store.get(req.workspaceId);
    if (!workspace) {
      send(IPC.TERM_ERROR, { sessionId: req.sessionId, message: 'Workspace not found' });
      return;
    }
    await terminals.open(req.sessionId, workspace, req.cols, req.rows);
  });

  ipcMain.on(IPC.TERM_INPUT, (_e, sessionId: string, data: string) => {
    terminals.input(sessionId, data);
  });

  ipcMain.on(IPC.TERM_RESIZE, (_e, req: TermResizeRequest) => {
    terminals.resize(req.sessionId, req.cols, req.rows);
  });

  ipcMain.on(IPC.TERM_CLOSE, (_e, sessionId: string) => {
    terminals.close(sessionId);
  });
}

app.whenReady().then(() => {
  store = new JsonWorkspaceStore(app.getPath('userData'));
  terminals = new TerminalSessionManager({
    onData: (sessionId, data) => send(IPC.TERM_DATA, { sessionId, data }),
    onExit: (sessionId, code) => send(IPC.TERM_EXIT, { sessionId, code }),
    onError: (sessionId, message) => send(IPC.TERM_ERROR, { sessionId, message })
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  terminals?.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  terminals?.closeAll();
});
