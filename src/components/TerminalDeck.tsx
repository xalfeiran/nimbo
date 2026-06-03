import { createPortal } from 'react-dom';
import { TerminalPanel, type ConnState } from './TerminalPanel';

interface TerminalDeckProps {
  /** DOM node to render the active terminal into (the selected workspace's slot). */
  target: HTMLElement | null;
  /** All open tabs, keyed by workspace id. */
  tabs: Record<string, string[]>;
  selectedId: string | null;
  /** Effective active tab for the selected workspace. */
  activeTabId?: string;
  pendingByTab: Record<string, string | null>;
  onPendingConsumed: (tabId: string) => void;
  onTabStatusChange: (tabId: string, state: ConnState) => void;
  onCloseTab: (workspaceId: string, tabId: string) => void;
}

/**
 * Renders every open terminal session ONCE and keeps it mounted for the
 * lifetime of its tab — regardless of which workspace/tab is currently
 * selected. Only the selected workspace's active tab is shown; all others are
 * hidden with `display:none` but remain connected.
 *
 * The whole set is portaled into `target` (the selected workspace's terminal
 * slot). Because the panels live in this single, always-mounted component,
 * switching workspaces or tabs just toggles visibility and re-parents DOM
 * nodes — it never unmounts/disposes an xterm instance, so SSH connections
 * stay alive.
 */
export function TerminalDeck({
  target,
  tabs,
  selectedId,
  activeTabId,
  pendingByTab,
  onPendingConsumed,
  onTabStatusChange,
  onCloseTab
}: TerminalDeckProps) {
  if (!target) return null;

  const content = (
    <>
      {Object.entries(tabs).flatMap(([wsId, list]) =>
        list.map((tid) => {
          const visible = wsId === selectedId && tid === activeTabId;
          return (
            <div
              key={tid}
              style={
                visible
                  ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
                  : { display: 'none' }
              }
            >
              <TerminalPanel
                tabId={tid}
                workspaceId={wsId}
                active={visible}
                pendingCommand={pendingByTab[tid] ?? null}
                onPendingConsumed={() => onPendingConsumed(tid)}
                onStatusChange={(s) => onTabStatusChange(tid, s)}
                onClose={() => onCloseTab(wsId, tid)}
              />
            </div>
          );
        })
      )}
    </>
  );

  return createPortal(content, target);
}
