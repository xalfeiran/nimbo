interface ConfirmModalProps {
  title: string;
  message: string;
  command?: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  command,
  danger,
  confirmLabel = 'Run',
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className={'modal__title' + (danger ? ' modal__title--danger' : '')}>
            {title}
          </h2>
        </div>
        <div className="modal__body">
          {message}
          {command && <code>{command}</code>}
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={'btn ' + (danger ? 'btn--danger' : 'btn--primary')}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
