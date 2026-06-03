import type { WorkspaceCommand } from '../types/workspace';

interface CommandButtonProps {
  command: WorkspaceCommand;
  disabled?: boolean;
  onRun: (command: WorkspaceCommand) => void;
}

export function CommandButton({ command, disabled, onRun }: CommandButtonProps) {
  const isDanger = command.dangerous || command.confirm;
  const icon = command.isLog ? '📄' : command.mode === 'output' ? '▸' : '⌘';
  return (
    <button
      className={'btn' + (isDanger ? ' btn--danger' : '')}
      disabled={disabled}
      onClick={() => onRun(command)}
      title={command.command}
    >
      {isDanger ? <span className="btn__danger-dot" /> : <span aria-hidden>{icon}</span>}
      {command.name}
    </button>
  );
}
