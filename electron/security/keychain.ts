/**
 * macOS Keychain credential storage — STUB for the MVP.
 *
 * The MVP intentionally stores NO secrets: it relies on unencrypted SSH keys
 * or the system ssh-agent. Raw SSH/sudo passwords are never persisted.
 *
 * A later milestone should back these functions with `keytar` (or Electron's
 * safeStorage) to hold key passphrases:
 *
 *   import keytar from 'keytar';
 *   const SERVICE = 'Nimbo';
 *   export const getSecret = (account) => keytar.getPassword(SERVICE, account);
 *   export const setSecret = (account, secret) => keytar.setPassword(SERVICE, account, secret);
 *   export const deleteSecret = (account) => keytar.deletePassword(SERVICE, account);
 *
 * keytar is a native module and is omitted from the MVP dependency set to keep
 * the install/build clean. Add it when implementing passphrase support.
 */

const NOT_IMPLEMENTED =
  'Keychain support is not implemented in the MVP. Use an unencrypted SSH key or ssh-agent.';

export async function getSecret(_account: string): Promise<string | null> {
  return null;
}

export async function setSecret(_account: string, _secret: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function deleteSecret(_account: string): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}
