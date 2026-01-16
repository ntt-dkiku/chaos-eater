/**
 * ProgressPanel component for displaying phase/agent progress.
 * Shows on hover over the clock icon in the chat input area.
 */

import React from 'react';
import { PHASE_CONFIG, AgentConfig, IMPROVEMENT_LOOP_PATTERNS, isImprovementLoopAgent } from '../config/phaseConfig';

type StatusType = 'completed' | 'active' | 'pending';

interface DynamicAgent {
  id: string;
  label: string;
  status: StatusType;
}

/**
 * Generate dynamic agents for the improvement loop phase.
 * Orders them: Experiment → Analysis N → Improvement N → Experiment → Analysis N+1 → ...
 *
 * Note: experiment_runner is always the same name, so we track runs by:
 * - Number of completed analyses = number of completed experiment runs
 * - If experiment_runner is currently active, add one more
 */
function getDynamicLoopAgents(
  completedAgents: Set<string>,
  currentAgent: string | null
): DynamicAgent[] {
  const agents: DynamicAgent[] = [];

  // Check experiment state
  const hasExperiment = completedAgents.has('experiment_runner') || currentAgent === 'experiment_runner';
  const experimentCompleted = completedAgents.has('experiment_runner');
  const experimentActive = currentAgent === 'experiment_runner';

  // Parse analyses and improvements
  const analyses: { id: string; iteration: number; status: StatusType }[] = [];
  const improvements: { id: string; iteration: number; retry?: number; status: StatusType }[] = [];

  const getStatus = (agentId: string): StatusType => {
    if (currentAgent === agentId) return 'active';
    if (completedAgents.has(agentId)) return 'completed';
    return 'pending';
  };

  for (const agentId of completedAgents) {
    if (IMPROVEMENT_LOOP_PATTERNS.analysis.test(agentId)) {
      const match = agentId.match(/^analysis_(\d+)$/);
      if (match) {
        analyses.push({ id: agentId, iteration: parseInt(match[1], 10), status: 'completed' });
      }
    } else if (IMPROVEMENT_LOOP_PATTERNS.improvement.test(agentId)) {
      const match = agentId.match(/^improvement_(\d+)(?:_(\d+))?$/);
      if (match) {
        improvements.push({
          id: agentId,
          iteration: parseInt(match[1], 10),
          retry: match[2] ? parseInt(match[2], 10) : undefined,
          status: 'completed',
        });
      }
    }
  }

  // Add current agent if it's analysis or improvement
  if (currentAgent && IMPROVEMENT_LOOP_PATTERNS.analysis.test(currentAgent)) {
    const match = currentAgent.match(/^analysis_(\d+)$/);
    if (match) {
      analyses.push({ id: currentAgent, iteration: parseInt(match[1], 10), status: 'active' });
    }
  } else if (currentAgent && IMPROVEMENT_LOOP_PATTERNS.improvement.test(currentAgent)) {
    const match = currentAgent.match(/^improvement_(\d+)(?:_(\d+))?$/);
    if (match) {
      improvements.push({
        id: currentAgent,
        iteration: parseInt(match[1], 10),
        retry: match[2] ? parseInt(match[2], 10) : undefined,
        status: 'active',
      });
    }
  }

  // Sort by iteration
  analyses.sort((a, b) => a.iteration - b.iteration);
  improvements.sort((a, b) => {
    if (a.iteration !== b.iteration) return a.iteration - b.iteration;
    return (a.retry ?? -1) - (b.retry ?? -1);
  });

  // Determine max iteration
  const maxAnalysis = analyses.length > 0 ? Math.max(...analyses.map((a) => a.iteration)) : -1;
  const maxImprovement = improvements.length > 0 ? Math.max(...improvements.map((i) => i.iteration)) : -1;
  let maxIteration = Math.max(maxAnalysis, maxImprovement);

  // If experiment is running but no analysis yet, show iteration 0
  if (hasExperiment && maxIteration < 0) {
    maxIteration = 0;
  }

  // Build sequence: for each iteration, add Experiment → Analysis → Improvement
  for (let i = 0; i <= maxIteration; i++) {
    // Determine experiment status for this iteration
    // - Experiment for iteration N is completed if analysis_N exists (or later)
    // - Experiment for the current iteration might be active or completed
    let expStatus: StatusType = 'pending';
    const analysisForIteration = analyses.find((a) => a.iteration === i);
    const hasLaterAnalysis = analyses.some((a) => a.iteration > i);

    if (analysisForIteration || hasLaterAnalysis) {
      // If analysis_N exists or later analysis exists, experiment for N is completed
      expStatus = 'completed';
    } else if (experimentActive) {
      // Current experiment is active, this is the latest iteration
      expStatus = 'active';
    } else if (experimentCompleted && i === maxIteration) {
      // Experiment completed but no analysis for this iteration yet
      expStatus = 'completed';
    }

    if (hasExperiment) {
      agents.push({
        id: `experiment_${i}`,
        label: i === 0 ? 'Experiment' : `Experiment (${i + 1})`,
        status: expStatus,
      });
    }

    // Analysis for this iteration
    if (analysisForIteration) {
      agents.push({
        id: analysisForIteration.id,
        label: `Analysis ${i}`,
        status: analysisForIteration.status,
      });
    }

    // Improvement for this iteration (including retries)
    const improvementsForIteration = improvements.filter((imp) => imp.iteration === i);
    for (const imp of improvementsForIteration) {
      const retryLabel = imp.retry !== undefined ? ` (retry ${imp.retry})` : '';
      agents.push({
        id: imp.id,
        label: `Improvement ${i}${retryLabel}`,
        status: imp.status,
      });
    }
  }

  return agents;
}

interface ProgressPanelProps {
  currentPhase: string | null;
  currentAgent: string | null;
  completedAgents: Set<string>;
  isVisible: boolean;
}

/**
 * Status icon for phases (larger)
 */
const PhaseStatusIcon: React.FC<{ status: StatusType }> = ({ status }) => {
  if (status === 'completed') {
    return (
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: '#84cc16',
        }}
      />
    );
  }
  if (status === 'active') {
    return (
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: '#84cc16',
          animation: 'progress-pulse 1.5s ease-in-out infinite',
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: '2px solid #4b5563',
      }}
    />
  );
};

/**
 * Status icon for agents (smaller)
 */
const AgentStatusIcon: React.FC<{ status: StatusType }> = ({ status }) => {
  if (status === 'completed') {
    return (
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: '#84cc16',
        }}
      />
    );
  }
  if (status === 'active') {
    return (
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: '#84cc16',
          animation: 'progress-pulse 1.5s ease-in-out infinite',
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: '1px solid #6b7280',
        boxSizing: 'border-box',
      }}
    />
  );
};

/**
 * Main ProgressPanel component
 */
export const ProgressPanel: React.FC<ProgressPanelProps> = ({
  currentPhase,
  currentAgent,
  completedAgents,
  isVisible,
}) => {
  /**
   * Determine phase status based on current phase
   */
  const getPhaseStatus = (phaseId: string): StatusType => {
    const phaseIndex = PHASE_CONFIG.findIndex((p) => p.id === phaseId);
    const currentIndex = PHASE_CONFIG.findIndex((p) => p.id === currentPhase);
    const phase = PHASE_CONFIG.find((p) => p.id === phaseId);

    // Handle dynamic phases (improvement_loop)
    if (phase?.dynamicAgents) {
      // Check if any improvement loop agent is current
      if (currentAgent && isImprovementLoopAgent(currentAgent)) {
        return 'active';
      }
      // Check if any improvement loop agent is completed
      const hasCompletedLoopAgent = [...completedAgents].some(isImprovementLoopAgent);
      if (hasCompletedLoopAgent) return 'completed';
      return 'pending';
    }

    if (currentIndex === -1) {
      // No current phase - all pending or check if agents completed
      if (phase) {
        const hasCompletedAgent = phase.agents.some((agent) => {
          if (agent.pattern) {
            return [...completedAgents].some((a) => agent.pattern!.test(a));
          }
          return completedAgents.has(agent.id);
        });
        if (hasCompletedAgent) return 'completed';
      }
      return 'pending';
    }

    if (phaseIndex < currentIndex) return 'completed';
    if (phaseIndex === currentIndex) return 'active';
    return 'pending';
  };

  /**
   * Determine agent status (with pattern matching support)
   */
  const getAgentStatus = (agent: AgentConfig): StatusType => {
    // Check if this is the current agent
    if (currentAgent) {
      if (agent.pattern) {
        if (agent.pattern.test(currentAgent)) return 'active';
      } else if (agent.id === currentAgent) {
        return 'active';
      }
    }

    // Check if completed (pattern matching)
    if (agent.pattern) {
      const matchingCompleted = [...completedAgents].some((a) =>
        agent.pattern!.test(a)
      );
      if (matchingCompleted) return 'completed';
    } else {
      if (completedAgents.has(agent.id)) return 'completed';
    }

    return 'pending';
  };

  return (
    <div
      style={{
        marginBottom: '8px',
        maxHeight: isVisible ? '300px' : '0',
        opacity: isVisible ? 1 : 0,
        overflow: 'hidden',
        transition: 'all 0.3s ease-out',
        backgroundColor: '#1e1e1e',
        border: isVisible ? '1px solid #333' : 'none',
        borderRadius: '8px',
        boxShadow: isVisible ? '0 -4px 20px rgba(0, 0, 0, 0.3)' : 'none',
        zIndex: 1000,
      }}
    >
      <div style={{ padding: '12px' }}>
        {/* Header */}
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: '#6b7280',
            marginBottom: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Progress
        </div>

        {/* Phases with agents - horizontal columns layout */}
        {(() => {
          // Get phases that should show (completed or active)
          const phasesToShow = PHASE_CONFIG.filter((phase) => {
            const status = getPhaseStatus(phase.id);
            return status === 'completed' || status === 'active';
          });

          return (
            <div
              style={{
                display: 'flex',
                gap: '16px',
                overflowX: 'auto',
                paddingBottom: '4px',
              }}
            >
              {PHASE_CONFIG.map((phase, index) => {
                const phaseStatus = getPhaseStatus(phase.id);
                const showAgents = phaseStatus === 'completed' || phaseStatus === 'active';

                return (
                  <div
                    key={phase.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      minWidth: 'fit-content',
                    }}
                  >
                    {/* Phase header with arrow */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: showAgents ? '8px' : '0',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          backgroundColor:
                            phaseStatus === 'active' ? 'rgba(132, 204, 22, 0.1)' : 'transparent',
                        }}
                      >
                        <PhaseStatusIcon status={phaseStatus} />
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            color:
                              phaseStatus === 'active'
                                ? '#84cc16'
                                : phaseStatus === 'completed'
                                ? '#6b7280'
                                : '#4b5563',
                          }}
                        >
                          {phase.label}
                        </span>
                      </div>
                      {index < PHASE_CONFIG.length - 1 && (
                        <div
                          style={{
                            width: '12px',
                            height: '1px',
                            backgroundColor: '#6b7280',
                            marginLeft: '4px',
                            marginRight: '-4px',
                          }}
                        />
                      )}
                    </div>

                    {/* Agents list - vertical under each phase */}
                    {showAgents && (
                      <div style={{ paddingLeft: '28px' }}>
                        {(() => {
                          // For dynamic phases (improvement_loop), generate agents dynamically
                          if (phase.dynamicAgents) {
                            const dynamicAgents = getDynamicLoopAgents(completedAgents, currentAgent);
                            if (dynamicAgents.length === 0) return null;

                            return dynamicAgents.map((agent, agentIndex) => {
                              const isLastAgent = agentIndex === dynamicAgents.length - 1;
                              const showConnector = !isLastAgent;

                              return (
                                <div key={agent.id}>
                                  {/* Agent row */}
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      fontSize: '10px',
                                      color:
                                        agent.status === 'active'
                                          ? '#84cc16'
                                          : agent.status === 'completed'
                                          ? '#6b7280'
                                          : '#4b5563',
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: '12px',
                                        display: 'flex',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                      }}
                                    >
                                      <AgentStatusIcon status={agent.status} />
                                    </div>
                                    <span style={{ marginLeft: '4px', whiteSpace: 'nowrap' }}>{agent.label}</span>
                                  </div>

                                  {/* Connector line */}
                                  {showConnector && (
                                    <div
                                      style={{
                                        width: '12px',
                                        display: 'flex',
                                        justifyContent: 'center',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: '1px',
                                          height: '8px',
                                          backgroundColor: '#6b7280',
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          }

                          // For static phases, use predefined agents
                          return phase.agents.map((agent, agentIndex) => {
                            const agentStatus = getAgentStatus(agent);
                            const isLastAgent = agentIndex === phase.agents.length - 1;
                            const showConnector = !isLastAgent;

                            return (
                              <div key={agent.id}>
                                {/* Agent row */}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontSize: '10px',
                                    color:
                                      agentStatus === 'active'
                                        ? '#84cc16'
                                        : agentStatus === 'completed'
                                        ? '#6b7280'
                                        : '#4b5563',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: '12px',
                                      display: 'flex',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <AgentStatusIcon status={agentStatus} />
                                  </div>
                                  <span style={{ marginLeft: '4px', whiteSpace: 'nowrap' }}>{agent.label}</span>
                                </div>

                                {/* Connector line */}
                                {showConnector && (
                                  <div
                                    style={{
                                      width: '12px',
                                      display: 'flex',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: '1px',
                                        height: '8px',
                                        backgroundColor: '#6b7280',
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default ProgressPanel;
