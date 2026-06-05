import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  systemPreferences
} from 'electron';
import path from 'node:path';
import { ICON_DATA_URL } from './icon';
import { JsonWorkspaceStore } from './storage/workspaceStore';
import { TerminalSessionManager } from './ssh/terminalSession';
import { runOutputCommand, runServiceChecks } from './ssh/commandRunner';
import { downloadFile, resolveRemotePath } from './ssh/fileTransfer';
import { configureKnownHosts } from './ssh/sshClient';
import { KnownHostsStore } from './ssh/knownHosts';
import { IPC } from '../src/types/ipc';
import type {
  TermOpenRequest,
  TermResizeRequest
} from '../src/types/ipc';
import type { ServiceCheck } from '../src/types/workspace';
import { workspaceInputSchema } from '../src/schemas/workspaceSchema';

// Ensure the macOS app menu / dock show "Nimbo" rather than "Electron",
// even in development. Must run before the application menu is built.
app.setName('Nimbo');

const isDev = !app.isPackaged;

// ---- Startup timing -------------------------------------------------------
// Logs elapsed time (ms since process start) at each launch milestone so we
// can see what's responsible for slow cold starts. Enabled by default; set
// NIMBO_PERF=0 to silence.
const T0 = Date.now();
const perfEnabled = process.env.NIMBO_PERF !== '0';
let lastMark = T0;
function perf(label: string): void {
  if (!perfEnabled) return;
  const now = Date.now();
  const sinceStart = now - T0;
  const sinceLast = now - lastMark;
  lastMark = now;
  console.log(`[perf] +${sinceStart}ms (Δ${sinceLast}ms) ${label}`);
}
perf('main module evaluated');

// The N logo, embedded as a data URI (see electron/icon.ts).
const appIcon = nativeImage.createFromDataURL(ICON_DATA_URL);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let lockWindow: BrowserWindow | null = null;
let store: JsonWorkspaceStore;
let terminals: TerminalSessionManager;

// Minimum time the splash stays visible so it does not just flicker.
const SPLASH_MIN_MS = 900;

// ---- Biometric app lock --------------------------------------------------

// Auto-lock after this much system idle time (no input anywhere).
const IDLE_LOCK_SECONDS = 5 * 60;
const IDLE_POLL_MS = 20_000;

let locked = true; // start locked; resolved at launch based on availability
let idleTimer: ReturnType<typeof setInterval> | null = null;

/** Touch ID availability on this machine (macOS only). */
let biometricCache: boolean | null = null;
function biometricAvailable(): boolean {
  // Cache the result: canPromptTouchID can be slow and is called repeatedly
  // (idle watch, lock/unlock, window setup).
  if (biometricCache !== null) return biometricCache;
  if (process.platform !== 'darwin') return (biometricCache = false);
  const t = Date.now();
  try {
    biometricCache = systemPreferences.canPromptTouchID();
  } catch {
    biometricCache = false;
  }
  perf(`biometricAvailable() resolved=${biometricCache} (took ${Date.now() - t}ms)`);
  return biometricCache;
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 360,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    center: true,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: appIcon
  });

  const splashHtml = `<!doctype html><html><head><meta charset="utf-8"/>
    <style>
      html,body{margin:0;height:100%;background:transparent;overflow:hidden;}
      .wrap{display:flex;align-items:center;justify-content:center;height:100%;
        background:radial-gradient(circle at 50% 42%, #151c2c 0%, #0c1018 70%);
        border-radius:22px;-webkit-app-region:drag;}
      .icon{width:168px;height:168px;
        animation:pop .5s cubic-bezier(.2,.9,.3,1.2) both;
        filter:drop-shadow(0 12px 32px rgba(31,157,255,.35));}
      @keyframes pop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
    </style></head>
    <body><div class="wrap"><img class="icon" src="${ICON_DATA_URL}"/></div></body></html>`;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0e1116',
    title: 'Nimbo',
    titleBarStyle: 'hiddenInset',
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Trace the renderer load lifecycle to see if HTML/JS loading is the bottleneck.
  const wc = mainWindow.webContents;
  wc.on('did-start-loading', () => perf('renderer: did-start-loading'));
  wc.on('dom-ready', () => perf('renderer: dom-ready'));
  wc.on('did-finish-load', () => perf('renderer: did-finish-load'));
  wc.on('did-fail-load', (_e, code, desc) =>
    perf(`renderer: did-fail-load ${code} ${desc}`)
  );

  // Reveal the main window only once it has painted, then dismiss the splash.
  const splashShownAt = Date.now();
  mainWindow.once('ready-to-show', () => {
    perf('mainWindow ready-to-show');
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
    perf(`enforcing splash min wait of ${wait}ms`);
    setTimeout(() => {
      perf('splash wait elapsed; revealing window');
      splashWindow?.close();
      if (biometricAvailable()) {
        // Stay hidden behind the lock screen until Touch ID succeeds.
        locked = true;
        createLockWindow();
      } else {
        // Allow-with-warning: no biometric hardware, open normally.
        locked = false;
        mainWindow?.show();
      }
    }, wait);
  });

  // Open external links in the system browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  perf('createWindow: starting renderer load');
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

// ---- Lock screen ---------------------------------------------------------

const LOCK_HTML = `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    html,body{margin:0;height:100%;overflow:hidden;font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8edf6;}
    .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100%;gap:18px;-webkit-app-region:drag;
      background:radial-gradient(circle at 50% 38%, #151c2c 0%, #0c1018 75%);}
    .logo{width:96px;height:96px;filter:drop-shadow(0 10px 28px rgba(31,157,255,.35));}
    h1{margin:0;font-size:19px;font-weight:600;letter-spacing:.2px;}
    p{margin:0;font-size:13px;color:#94a3b8;max-width:280px;text-align:center;line-height:1.5;}
    button{-webkit-app-region:no-drag;margin-top:6px;border:0;border-radius:10px;
      padding:11px 22px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;
      background:linear-gradient(180deg,#2a93ff,#1f7fe0);box-shadow:0 6px 18px rgba(31,127,224,.4);}
    button:active{transform:translateY(1px);}
    button:disabled{opacity:.6;cursor:default;}
    .err{color:#ff8585;min-height:18px;}
    .min{-webkit-app-region:no-drag;position:absolute;top:14px;right:16px;
      width:30px;height:30px;padding:0;margin:0;border-radius:8px;
      display:flex;align-items:center;justify-content:center;
      background:rgba(148,163,184,.14);box-shadow:none;color:#94a3b8;
      font-size:18px;line-height:1;font-weight:600;}
    .min:hover{background:rgba(148,163,184,.26);color:#e8edf6;}
  </style></head>
  <body><div class="wrap">
    <button class="min" id="minimize" title="Minimize">&#8211;</button>
    <img class="logo" src="__ICON__"/>
    <h1>Nimbo is locked</h1>
    <p id="hint">Unlock with Touch ID to continue.</p>
    <button id="unlock">Unlock with Touch ID</button>
    <p class="err" id="err"></p>
  </div>
  <script>
    const btn = document.getElementById('unlock');
    const err = document.getElementById('err');
    document.getElementById('minimize')
      .addEventListener('click', () => window.nimbo.minimizeLock());
    async function tryUnlock(){
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Waiting for Touch ID…';
      try {
        const res = await window.nimbo.requestUnlock();
        if (!res.ok) {
          err.textContent = res.error || 'Authentication failed.';
        }
      } catch (e) {
        err.textContent = 'Authentication error.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Unlock with Touch ID';
      }
    }
    btn.addEventListener('click', tryUnlock);
    // Auto-prompt as soon as the lock screen appears.
    window.addEventListener('DOMContentLoaded', () => setTimeout(tryUnlock, 350));
  </script>
  </body></html>`;

function createLockWindow(): void {
  if (lockWindow) return;
  const bounds = mainWindow?.getBounds();
  lockWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 780,
    x: bounds?.x,
    y: bounds?.y,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: true,
    show: false,
    backgroundColor: '#0c1018',
    title: 'Nimbo — Locked',
    // Not always-on-top: the lock screen guards Nimbo's own content but should
    // not float above other apps' windows — the user can move it behind them.
    alwaysOnTop: false,
    fullscreenable: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const html = LOCK_HTML.replace('__ICON__', ICON_DATA_URL);
  lockWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  lockWindow.once('ready-to-show', () => {
    perf('lock window ready-to-show (Touch ID prompt next)');
    lockWindow?.show();
  });
  lockWindow.on('closed', () => {
    lockWindow = null;
  });
}

/** Hide the app behind the lock screen and require biometric re-auth. */
function lock(): void {
  if (locked) return;
  if (!biometricAvailable()) return; // never lock if we can't unlock
  locked = true;
  mainWindow?.hide();
  createLockWindow();
  lockWindow?.show();
  lockWindow?.focus();
}

/** Reveal the app after a successful unlock. */
function unlock(): void {
  locked = false;
  if (lockWindow) {
    lockWindow.close();
    lockWindow = null;
  }
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function startIdleWatch(): void {
  if (idleTimer || !biometricAvailable()) return;
  idleTimer = setInterval(() => {
    if (locked) return;
    try {
      if (powerMonitor.getSystemIdleTime() >= IDLE_LOCK_SECONDS) lock();
    } catch {
      // getSystemIdleTime unsupported here; ignore.
    }
  }, IDLE_POLL_MS);
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function registerIpc(): void {
  // ---- Biometric lock ----
  ipcMain.handle(IPC.AUTH_INFO, () => ({
    biometricAvailable: biometricAvailable(),
    method: biometricAvailable() ? ('touch-id' as const) : ('none' as const)
  }));

  ipcMain.handle(IPC.AUTH_UNLOCK, async () => {
    if (!biometricAvailable()) {
      // No biometric: fail open (allow-with-warning policy).
      unlock();
      return { ok: true };
    }
    try {
      await systemPreferences.promptTouchID('unlock Nimbo');
      unlock();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message || 'Touch ID was cancelled.' };
    }
  });

  // Minimize the lock screen to the dock without unlocking.
  ipcMain.on(IPC.AUTH_MINIMIZE, () => {
    lockWindow?.minimize();
  });

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

  // ---- File download (SFTP) ----
  ipcMain.handle(IPC.FILE_DOWNLOAD, async (_e, workspaceId: string, remoteName: string) => {
    const workspace = await store.get(workspaceId);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found`);

    // Validate/resolve the name up front so dialog only appears for valid input.
    let suggested: string;
    try {
      const remotePath = resolveRemotePath(workspace.remotePath, remoteName);
      suggested = path.basename(remotePath);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    const parent = lockWindow ?? mainWindow;
    const opts = {
      title: 'Save downloaded file',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      buttonLabel: 'Download'
    };
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts);
    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      const { remotePath, bytes } = await downloadFile(workspace, remoteName, filePath);
      return { ok: true, savedTo: filePath, remotePath, bytes };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

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

function configureAboutPanel(): void {
  // Populates the native "About Nimbo" panel (macOS app menu / Linux).
  app.setAboutPanelOptions({
    applicationName: 'Nimbo',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright:
      '© 2026 Mindware. Made by Xavier — mindware.com.mx\n\n' +
      'Nimbo is an app-centered SSH workspace and runbook tool for developers ' +
      'managing multiple apps across shared servers. Define workspaces, run ' +
      'saved commands and service checks, and open interactive terminals — all ' +
      'from one place.',
    credits: 'Made by Xavier · mindware.com.mx',
    authors: ['Xavier (Mindware)'],
    website: 'https://mindware.com.mx'
  });
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Nimbo',
            submenu: [
              { role: 'about' as const, label: 'About Nimbo' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide Nimbo' },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit Nimbo' }
            ]
          } as Electron.MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([{ type: 'separator' }, { role: 'front' }] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as Electron.MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'mindware.com.mx',
          click: () => shell.openExternal('https://mindware.com.mx')
        },
        ...(!isMac
          ? ([{ role: 'about', label: 'About Nimbo' }] as Electron.MenuItemConstructorOptions[])
          : [])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  perf('app ready (whenReady)');
  // Dock icon on macOS (the window `icon` option is ignored there).
  if (process.platform === 'darwin' && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }

  configureAboutPanel();
  buildAppMenu();
  perf('menu + about panel built');

  createSplashWindow();
  perf('splash window created');

  const userData = app.getPath('userData');
  store = new JsonWorkspaceStore(userData);
  perf('workspace store initialized');
  configureKnownHosts(new KnownHostsStore(userData));
  terminals = new TerminalSessionManager({
    onData: (sessionId, data) => send(IPC.TERM_DATA, { sessionId, data }),
    onExit: (sessionId, code) => send(IPC.TERM_EXIT, { sessionId, code }),
    onError: (sessionId, message) => send(IPC.TERM_ERROR, { sessionId, message })
  });
  perf('known hosts + terminal manager ready');

  registerIpc();
  createWindow();
  perf('createWindow() returned');

  if (biometricAvailable()) {
    // Re-lock when the machine sleeps or the OS screen locks, and after idle.
    powerMonitor.on('suspend', lock);
    powerMonitor.on('lock-screen', lock);
    startIdleWatch();
  } else {
    console.warn(
      '[Nimbo] Touch ID is not available on this device; the app lock is ' +
        'disabled and Nimbo will open without biometric authentication.'
    );
  }

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
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
});
