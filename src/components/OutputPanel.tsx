import { useState } from 'react';
import type { CommandResult } from '../types/workspace';

export interface OutputState {
  commandName: string;
  running: boolean;
  result?: CommandResult;
}

interface OutputPanelProps {
  output: OutputState;
  onClose: () => void;
}

const MIN_H = 80;
const DEFAULT_H = 220;

export function OutputPanel({ output, onClose }: OutputPanelProps) {
  const [maximized, setMaximized] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(DEFAULT_H);
  const { commandName, running, result } = output;
  const hasError = !!result?.error;
  const body = running
    ? 'Running…'
    : result?.error
      ? result.error
      : [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim() ||
        '(no output)';

  const exitInfo =
    !running && result && result.exitCode !== null && result.exitCode !== 0 ? (
      <span style={{ color: 'var(--red)' }}> · exit {result.exitCode}</span>
    ) : null;

  const bodyClass = 'output-panel__body' + (hasError ? ' output-panel__body--err' : '');

  // Drag the bottom-right handle to grow/shrink the inline panel.
  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bodyHeight;
    const maxH = window.innerHeight * 0.8;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      setBodyHeight(Math.max(MIN_H, Math.min(maxH, startH + dy)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Fullscreen view for reading long output.
  if (maximized) {
    return (
      <div className="modal-overlay" onMouseDown={() => setMaximized(false)}>
        <div className="output-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="output-modal__bar">
            <span>
              Output · <b style={{ color: 'var(--text)' }}>{commandName}</b>
              {exitInfo}
            </span>
            <div className="actions-row">
              <button className="btn btn--ghost btn--sm" onClick={() => setMaximized(false)}>
                Minimize
              </button>
              <button
                className="btn btn--sm"
                onClick={() => {
                  setMaximized(false);
                  onClose();
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
          <pre className={bodyClass + ' output-modal__body'}>{body}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="output-panel">
      <div className="output-panel__bar">
        <span>
          Output · <b style={{ color: 'var(--text)' }}>{commandName}</b>
          {exitInfo}
        </span>
        <div className="actions-row">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setMaximized(true)}
            title="Expand to read full output"
          >
            Maximize
          </button>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
      <div className="output-panel__bodywrap">
        <pre className={bodyClass} style={{ height: bodyHeight }}>
          {body}
        </pre>
        <div
          className="output-panel__resizer"
          onPointerDown={onHandleDown}
          title="Drag to resize"
        />
      </div>
    </div>
  );
}
