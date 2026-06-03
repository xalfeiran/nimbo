import type { Workspace } from '../types/workspace';

interface SidebarProps {
  workspaces: Workspace[];
  selectedId: string | null;
  connectedByWs: Record<string, boolean>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onCollapse: () => void;
}

export function Sidebar({
  workspaces,
  selectedId,
  connectedByWs,
  onSelect,
  onAdd,
  onCollapse
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__brand">
          <div className="sidebar__title">
            Nim<span>bo</span>
          </div>
          <div className="sidebar__subtitle">by mindware.com.mx</div>
        </div>
        <div className="sidebar__header-actions">
          <button className="sidebar__add" title="Add workspace" onClick={onAdd}>
            +
          </button>
          <button
            className="sidebar__collapse"
            title="Collapse sidebar"
            onClick={onCollapse}
          >
            «
          </button>
        </div>
      </div>
      {workspaces.length === 0 ? (
        <div className="sidebar__empty">
          No workspaces yet.
          <br />
          Click + to create one.
        </div>
      ) : (
        <ul className="sidebar__list">
          {workspaces.map((w) => (
            <li
              key={w.id}
              className={'ws-item' + (w.id === selectedId ? ' ws-item--active' : '')}
              onClick={() => onSelect(w.id)}
            >
              <div className="ws-item__name">
                {connectedByWs[w.id] && (
                  <span className="ws-item__dot" title="Connected" />
                )}
                {w.name}
              </div>
              <div className="ws-item__host">
                {w.username}@{w.hostname}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
