/**
 * POSIX single-quote escaping for safely interpolating untrusted values
 * (paths, env values, commands) into a remote shell command.
 *
 * Wraps the string in single quotes and escapes embedded single quotes using
 * the classic '\'' trick. The result is safe to drop verbatim into a
 * /bin/sh command line.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote a remote path for `cd`, preserving a leading `~` / `~/` by expanding it
 * to the remote `$HOME` (single quotes would otherwise suppress tilde
 * expansion and break `cd`). The rest of the path is still safely quoted.
 *   ~                -> "$HOME"
 *   ~/app/current    -> "$HOME"/'app/current'
 *   /var/www/app     -> '/var/www/app'
 */
export function quotePath(p: string): string {
  if (p === '~') return '"$HOME"';
  if (p.startsWith('~/')) return `"$HOME"/${shellQuote(p.slice(2))}`;
  return shellQuote(p);
}

/**
 * Build the `export KEY='value' KEY2='value2'` fragment for a set of env vars.
 * Returns an empty string when there are no vars. Keys are validated to a
 * conservative shell-identifier pattern; invalid keys are skipped.
 */
export function buildExports(env?: Record<string, string>): string {
  if (!env) return '';
  const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const parts = Object.entries(env)
    .filter(([key]) => validKey.test(key))
    .map(([key, value]) => `${key}=${shellQuote(value)}`);
  return parts.length ? `export ${parts.join(' ')}` : '';
}

/**
 * Compose a non-interactive command for output mode:
 *   cd '<path>' && export KEY='v' && <command>
 * Each segment is omitted when not applicable.
 */
export function buildOutputCommand(
  command: string,
  remotePath?: string,
  env?: Record<string, string>
): string {
  const segments: string[] = [];
  if (remotePath) segments.push(`cd ${quotePath(remotePath)}`);
  const exports = buildExports(env);
  if (exports) segments.push(exports);
  segments.push(command);
  return segments.join(' && ');
}

/**
 * Compose the bootstrap a fresh interactive shell runs on connect:
 *   cd '<path>'; export KEY='v'; exec "$SHELL" -l   (falls back to bash -l)
 * Uses `;` (not `&&`) so a missing remotePath doesn't abort the login shell.
 */
export function buildInteractiveBootstrap(
  remotePath?: string,
  env?: Record<string, string>
): string {
  const lines: string[] = [];
  if (remotePath) lines.push(`cd ${quotePath(remotePath)}`);
  const exports = buildExports(env);
  if (exports) lines.push(exports);
  // Prefer the user's login shell; fall back to bash, then sh.
  lines.push('exec "${SHELL:-/bin/bash}" -l');
  return lines.join('\n') + '\n';
}
