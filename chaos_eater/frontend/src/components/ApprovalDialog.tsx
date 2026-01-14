import React, { useState, useEffect } from 'react';
import { CheckCircle, RotateCcw, XCircle } from 'lucide-react';

export interface ApprovalDialogProps {
  agentName: string;
  onApprove: (message?: string) => void;
  onRetry: (message?: string) => void;
  onCancel: () => void;
}

export default function ApprovalDialog({
  agentName,
  onApprove,
  onRetry,
  onCancel,
}: ApprovalDialogProps): React.ReactElement {
  const [message, setMessage] = useState('');

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in textarea
      if (e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          onCancel();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onApprove(message || undefined);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        onRetry(message || undefined);
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onApprove, onRetry, onCancel, message]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h3 style={styles.title}>Agent Approval Required</h3>
        <p style={styles.agentName}>{agentName}</p>

        <textarea
          placeholder="Enter message (optional)..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={styles.textarea}
          rows={3}
        />

        <div style={styles.buttonGroup}>
          <button
            onClick={() => onApprove(message || undefined)}
            style={styles.approveButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#16a34a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#22c55e';
            }}
          >
            <CheckCircle size={18} />
            <span>Approve</span>
            <span style={styles.shortcut}>Enter</span>
          </button>
          <button
            onClick={() => onRetry(message || undefined)}
            style={styles.retryButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#ca8a04';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#eab308';
            }}
          >
            <RotateCcw size={18} />
            <span>Retry</span>
            <span style={styles.shortcut}>R</span>
          </button>
          <button
            onClick={onCancel}
            style={styles.cancelButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ef4444';
            }}
          >
            <XCircle size={18} />
            <span>Cancel</span>
            <span style={styles.shortcut}>Esc</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    backgroundColor: '#171717',
    border: '1px solid #374151',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '480px',
    width: '90%',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  title: {
    margin: 0,
    marginBottom: '8px',
    fontSize: '18px',
    fontWeight: 600,
    color: '#e5e7eb',
  },
  agentName: {
    margin: 0,
    marginBottom: '16px',
    fontSize: '14px',
    color: '#84cc16',
    fontFamily: 'monospace',
    backgroundColor: '#1f2937',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  textarea: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#0a0a0a',
    border: '1px solid #374151',
    borderRadius: '8px',
    color: '#e5e7eb',
    fontSize: '14px',
    resize: 'vertical',
    outline: 'none',
    marginBottom: '16px',
    boxSizing: 'border-box',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  approveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    backgroundColor: '#22c55e',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  retryButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    backgroundColor: '#eab308',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  cancelButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    backgroundColor: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  shortcut: {
    fontSize: '11px',
    opacity: 0.7,
    marginLeft: '4px',
    padding: '2px 4px',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: '3px',
  },
};
