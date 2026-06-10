# Nimbo

**An app-centered SSH workspace and runbook tool for developers managing multiple apps across shared servers.**

Nimbo is not just another terminal. It organizes SSH access, commands, logs, and service checks around your **applications** instead of around servers. If you run several apps on one or more machines, Nimbo knows which application you're working on, where it lives, what commands matter, which logs matter, and what services should be alive.

> macOS-first desktop app · local-only · no cloud, no accounts, no telemetry.

---

## Why

Developers who manage multiple apps on the same server constantly juggle SSH commands, app paths, keys, logs, queue workers, Docker containers, services, and deploy commands. That creates friction and risk — especially running the right command in the *wrong* app or environment.

Nimbo gives each app/environment a **workspace** that knows how to:

- connect over SSH,
- `cd` into the correct app directory,
- export app-specific environment variables,
- expose quick actions: open a shell, tail logs, check services, run saved commands.

---

## Features

- **Workspaces** — create, edit, duplicate, and delete app/environment workspaces. Each stores host, port, user, key path, remote path, env vars, command shortcuts, and service checks.
- **Embedded SSH terminal** — full interactive shell via [xterm.js](https://xtermjs.org/): colors, resize, Ctrl+C/Ctrl+D, arrow keys, copy/paste. On connect it auto-`cd`s into the app path and exports the workspace env.
- **Multiple persistent connections** — open several shells per workspace as tabs. Switching workspaces or tabs never drops a session.
- **Command shortcuts** — saved commands run either in the interactive **terminal** or as a one-shot **output** panel. Commands marked dangerous require a confirmation modal.
- **Service checks** — per-workspace health probes (e.g. `systemctl is-active nginx`) compared against an expected value, shown as green/red/amber/gray badges. Auto-refreshes on connect; manual refresh available.
- **Developer-tool UI** — dark, compact, keyboard-friendly. Collapsible sidebar, connection-status dots, resizable output panel, terminal that fills the window.
- **Safe by default** — SSH keys preferred; no passwords or sudo passwords are ever stored; command/env/path values are shell-escaped before being sent.

---

## Tech stack

| Layer        | Tech                                                        |
| ------------ | ---------------------------------------------------------- |
| Shell        | [Electron](https://www.electronjs.org/)                    |
| Build        | [electron-vite](https://electron-vite.org/) + [Vite](https://vitejs.dev/) |
| UI           | [React](https://react.dev/) + TypeScript                  |
| Terminal     | [@xterm/xterm](https://xtermjs.org/) + fit addon          |
| SSH          | [ssh2](https://github.com/mscdex/ssh2)                     |
| Validation   | [zod](https://zod.dev/)                                    |
| Persistence  | Local JSON in the app's `userData` dir                     |

---

## Getting started

### Prerequisites

- **macOS** (primary target; other platforms are untested)
- **Node.js 18+** (developed on Node 22)
- An SSH server you can reach, with key-based auth

### Install & run

```bash
git clone <your-fork-or-repo-url>
cd nimbo
npm install
npm run dev        # launches the app with hot reload + devtools
```

### Production build

```bash
npm run build      # bundles main, preload, and renderer into out/
npm run start      # preview the production build
```

### Type-checking

```bash
npm run typecheck  # tsc for both the Node (main/preload) and web (renderer) projects
```

---

## Configuring a workspace

Create workspaces from the UI (the **+** in the sidebar), or edit the JSON store directly. The store lives in your Electron `userData` directory:

```
~/Library/Application Support/Nimbo/workspaces.json
```

Each workspace looks like:

```json
{
  "id": "webroster-prod",
  "name": "WebRoster Production",
  "hostname": "203.0.113.10",
  "port": 22,
  "username": "deploy",
  "identityFile": "~/.ssh/webroster_prod",
  "remotePath": "/var/www/webroster",
  "env": {
    "APP_CONTEXT": "webroster",
    "APP_ENV": "production"
  },
  "commands": [
    { "id": "laravel-log", "name": "Tail Laravel Log", "command": "tail -f storage/logs/laravel.log", "mode": "terminal", "isLog": true },
    { "id": "supervisor-status", "name": "Check Supervisor", "command": "supervisorctl status", "mode": "output" },
    { "id": "restart-workers", "name": "Restart Workers", "command": "sudo supervisorctl restart laravel-worker:*", "mode": "terminal", "dangerous": true, "confirm": true }
  ],
  "serviceChecks": [
    { "id": "nginx", "name": "Nginx", "command": "systemctl is-active nginx", "expected": "active" }
  ]
}
```

| Field           | Notes                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `identityFile`  | Path to an SSH private key. `~` is expanded. Optional (see auth).    |
| `remotePath`    | Directory to `cd` into on connect and before output-mode commands.  |
| `env`           | Exported on connect and per command.                                |
| `commands[].mode` | `"terminal"` (types into a shell) or `"output"` (one-shot panel).  |
| `commands[].dangerous` / `confirm` | Gate execution behind a confirmation modal.        |
| `serviceChecks[].expected` | Output is trimmed and compared case-insensitively.         |

---

## Project structure

```
nimbo/
├─ electron/                 # Main process (Node) — owns SSH, storage, IPC
│  ├─ main.ts                # Window + IPC handlers
│  ├─ preload.ts             # Typed contextBridge API (window.nimbo)
│  ├─ ssh/                   # ssh2 client, terminal sessions, command runner, escaping
│  ├─ storage/               # JSON workspace store + seed data
│  └─ security/              # Keychain stub (passphrase support TODO)
├─ src/                      # Renderer (React) — pure UI
│  ├─ App.tsx
│  ├─ components/            # Sidebar, WorkspaceDetail, TerminalPanel, TerminalDeck, …
│  ├─ schemas/               # zod schemas
│  ├─ types/                 # shared domain + IPC types
│  └─ styles/
└─ electron.vite.config.ts
```

The renderer never touches the network or filesystem directly — everything goes through the typed `window.nimbo` bridge to the main process.

---

## Security & known limitations

Nimbo is an early MVP. Please read these before pointing it at production hosts:

- **Host key verification is not implemented yet.** The MVP accepts a server's host key on first sight without persisting it (TOFU without storage), which is vulnerable to MITM. A real `known_hosts`-based verifier is planned. See `electron/ssh/sshClient.ts`.
- **Encrypted (passphrase-protected) keys are not yet supported directly.** Use an unencrypted key, or load your key into `ssh-agent` (`ssh-add --apple-use-keychain ~/.ssh/key`) and leave the key path blank — Nimbo falls back to the agent.
- **No secrets are stored.** Raw SSH/sudo passwords are never persisted. Keychain-backed passphrase storage (`keytar`) is stubbed for a future milestone.
- **Dangerous commands** require explicit confirmation, but Nimbo cannot know what's destructive on *your* systems — mark commands `dangerous`/`confirm` accordingly.

---

## Roadmap

- [ ] `known_hosts` verification and first-connect prompts
- [ ] Passphrase prompts + macOS Keychain storage
- [ ] YAML/JSON config import & export
- [ ] Notifications for failed service checks + optional polling
- [ ] SQLite persistence option (storage layer is already abstracted)
- [ ] Windows/Linux support

---

## Contributing

Contributions are very welcome! 🙌

1. **Fork** the repo and create a branch: `git checkout -b feature/my-change`.
2. Make your change. Keep the renderer free of direct Node/SSH access — route everything through the `window.nimbo` IPC bridge.
3. Run `npm run typecheck` and make sure it passes.
4. Use clear, conventional commit messages.
5. Open a **pull request** describing the change and the motivation.

Good first contributions: items from the roadmap, additional service-check presets, UX polish, and cross-platform fixes. For larger changes, please open an issue first to discuss the approach.

Found a bug or have an idea? **Open an issue** — please include your OS, Node version, and steps to reproduce.

---

## License

To be finalized before the first tagged release — MIT is the intended license. Until then the code is provided as-is; if you'd like to use it, please open an issue.

---

Built by [Mindware](https://mindware.com.mx).
