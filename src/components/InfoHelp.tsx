import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface InfoButtonProps {
  /** Title shown at the top of the help window. */
  title: string;
  /** Explanation body. Plain string or rich nodes. */
  children: ReactNode;
  /** Render a wider window for long, multi-step guides (e.g. SSH keys). */
  wide?: boolean;
  /** Accessible label / tooltip for the trigger button. */
  label?: string;
}

/**
 * A small "ⓘ" trigger that opens a separate help window (modal) explaining
 * the adjacent concept. Each instance manages its own open state so it can be
 * dropped next to any form field.
 */
export function InfoButton({ title, children, wide, label }: InfoButtonProps) {
  const [open, setOpen] = useState(false);

  // Close on Escape while the window is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="info-btn"
        aria-label={label ?? `What is "${title}"?`}
        title={label ?? `What is "${title}"?`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        i
      </button>

      {open &&
        createPortal(
          <div
            className="info-overlay"
            onMouseDown={() => setOpen(false)}
            role="presentation"
          >
            <div
              className={'info-window' + (wide ? ' info-window--wide' : '')}
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={title}
            >
              <div className="info-window__header">
                <h3 className="info-window__title">{title}</h3>
                <button
                  type="button"
                  className="info-window__close"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="info-window__body">{children}</div>
              <div className="info-window__footer">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setOpen(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** A full-width command block (its own line) reused inside help windows. */
export function Cmd({ children }: { children: ReactNode }) {
  return <code className="info-cmd">{children}</code>;
}

/** Short inline code: a path, a value, a flag — flows within the sentence. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="info-code">{children}</code>;
}

/** A numbered step block for guides. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="info-step">
      <div className="info-step__num">{n}</div>
      <div className="info-step__content">
        <div className="info-step__title">{title}</div>
        <div className="info-step__text">{children}</div>
      </div>
    </div>
  );
}

/**
 * Full walkthrough for creating an SSH key pair on the server, downloading it,
 * placing it under ~/.ssh, and registering it with the macOS keychain.
 * Rendered inside its own wide help window.
 */
export function SshKeyGuide() {
  return (
    <>
      <p className="info-lead">
        AppShell logs in to your server with an <strong>SSH key pair</strong> instead of a
        password. You create the pair once, keep the <strong>private key</strong> on this
        computer, and put the matching <strong>public key</strong> on the server. The field
        you’re filling in just points AppShell at that private key file.
      </p>

      <Step n={1} title="Generate the key pair">
        On a terminal (this can be your Mac, or the server over SSH), run:
        <Cmd>ssh-keygen -t ed25519 -C "appshell-yourserver" -f ~/.ssh/webroster_prod</Cmd>
        Press Enter to accept the location. You may set a passphrase for extra safety, but
        note AppShell currently can’t open passphrase‑encrypted keys, so for now leave it
        empty. This creates two files: <Code>webroster_prod</Code> (private — keep secret) and{' '}
        <Code>webroster_prod.pub</Code> (public — safe to share).
      </Step>

      <Step n={2} title="Install the public key on the server">
        Copy the <strong>public</strong> key into the server’s authorized list. The easiest way:
        <Cmd>ssh-copy-id -i ~/.ssh/webroster_prod.pub deploy@203.0.113.10</Cmd>
        Or do it manually — append the contents of <Code>webroster_prod.pub</Code> to{' '}
        <Code>~/.ssh/authorized_keys</Code> in the server account you’ll connect as.
      </Step>

      <Step n={3} title="If you generated the key ON the server, download the private key">
        You need the <strong>private</strong> key on this Mac. From your Mac, pull it down with:
        <Cmd>scp deploy@203.0.113.10:~/.ssh/webroster_prod ~/.ssh/webroster_prod</Cmd>
        Then delete it from the server so the secret lives in only one place. Skip this step
        if you generated the key on your Mac in step 1.
      </Step>

      <Step n={4} title="Place it in your ~/.ssh folder and lock down permissions">
        SSH refuses keys that are readable by others. Make sure the file is private:
        <Cmd>{'mkdir -p ~/.ssh\nchmod 700 ~/.ssh\nchmod 600 ~/.ssh/webroster_prod'}</Cmd>
        After this, <Code>~/.ssh/webroster_prod</Code> is the path you enter in the SSH private
        key field.
      </Step>

      <Step n={5} title="Add the key to the macOS keychain (optional but recommended)">
        This stores the key in your login keychain and loads it into the agent so you’re not
        prompted again:
        <Cmd>ssh-add --apple-use-keychain ~/.ssh/webroster_prod</Cmd>
        To have it load automatically on every login, add this to <Code>~/.ssh/config</Code>:
        <Cmd>{'Host 203.0.113.10\n  IdentityFile ~/.ssh/webroster_prod\n  UseKeychain yes\n  AddKeysToAgent yes'}</Cmd>
      </Step>

      <Step n={6} title="Point AppShell at the key">
        Back in the form, enter the private‑key path — for example{' '}
        <Code>~/.ssh/webroster_prod</Code>. The <Code>~</Code> is expanded automatically when
        AppShell connects. Leave the field empty if you’d rather rely on the running ssh‑agent.
      </Step>

      <p className="info-note">
        Never share or commit the private key file. Only the <Code>.pub</Code> file belongs on
        servers or in chats.
      </p>
    </>
  );
}
