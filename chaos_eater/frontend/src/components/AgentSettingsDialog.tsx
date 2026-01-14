import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface AgentSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  approvalAgents: string[];
  onApprovalAgentsChange: (agents: string[]) => void;
  agentGroups: Record<string, Array<{ id: string; label: string }>>;
}

export default function AgentSettingsDialog({
  isOpen,
  onClose,
  approvalAgents,
  onApprovalAgentsChange,
  agentGroups,
}: AgentSettingsDialogProps): React.ReactElement | null {
  if (!isOpen) return null;

  const allAgentIds = Object.values(agentGroups).flat().map(a => a.id);

  const handleSelectAll = () => onApprovalAgentsChange([...allAgentIds]);
  const handleDeselectAll = () => onApprovalAgentsChange([]);

  // Keyboard: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>Agent Approval Settings</h3>
          <button
            onClick={onClose}
            style={styles.closeButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#e5e7eb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#9ca3af';
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={styles.selectAllRow}>
          <button
            onClick={handleSelectAll}
            style={styles.linkButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#a3e635';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#84cc16';
            }}
          >
            Select All
          </button>
          <span style={{ color: '#6b7280' }}>/</span>
          <button
            onClick={handleDeselectAll}
            style={styles.linkButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#a3e635';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#84cc16';
            }}
          >
            Deselect All
          </button>
        </div>

        <div style={styles.content}>
          {Object.entries(agentGroups).map(([phase, agents]) => (
            <div key={phase} style={styles.phaseGroup}>
              <div style={styles.phaseLabel}>
                {phase.replace('_', ' ')}
              </div>
              {agents.map(agent => (
                <label key={agent.id} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={approvalAgents.includes(agent.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onApprovalAgentsChange([...approvalAgents, agent.id]);
                      } else {
                        onApprovalAgentsChange(approvalAgents.filter(a => a !== agent.id));
                      }
                    }}
                    style={styles.checkbox}
                  />
                  <span style={{ color: '#d1d5db' }}>{agent.label}</span>
                </label>
              ))}
            </div>
          ))}
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
    maxWidth: '520px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#e5e7eb',
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'color 0.15s',
  },
  selectAllRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #374151',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#84cc16',
    fontSize: '13px',
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    transition: 'color 0.15s',
  },
  content: {
    overflowY: 'auto',
    flex: 1,
  },
  phaseGroup: {
    marginBottom: '16px',
  },
  phaseLabel: {
    fontSize: '12px',
    color: '#9ca3af',
    textTransform: 'capitalize',
    marginBottom: '6px',
    fontWeight: 500,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  checkbox: {
    width: '14px',
    height: '14px',
    cursor: 'pointer',
    accentColor: '#84cc16',
  },
};
