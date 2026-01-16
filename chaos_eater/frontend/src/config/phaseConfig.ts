/**
 * Phase configuration for the progress indicator.
 * Defines all phases and their agents in execution order.
 */

export interface AgentConfig {
  id: string;
  label: string;
  pattern?: RegExp;  // For agents with dynamic names like draft_agent_0, draft_agent_1
}

export interface PhaseConfig {
  id: string;
  label: string;
  agents: AgentConfig[];
  dynamicAgents?: boolean;  // For phases with dynamically generated agents (e.g., improvement_loop)
}

export const PHASE_CONFIG: PhaseConfig[] = [
  {
    id: 'preprocess',
    label: 'Preprocess',
    agents: [
      { id: 'k8s_summary_agent', label: 'K8s Summary' },
      { id: 'k8s_weakness_summary_agent', label: 'Weakness Summary' },
      { id: 'k8s_app_assumption_agent', label: 'App Assumption' },
      { id: 'ce_instruct_agent', label: 'CE Instructions' },
    ],
  },
  {
    id: 'hypothesis',
    label: 'Hypothesis',
    agents: [
      { id: 'steady_state_definer', label: 'Steady State' },
      { id: 'draft_agent', label: 'Draft', pattern: /^draft_agent/ },
      { id: 'inspection_agent', label: 'Inspection', pattern: /^inspection_agent/ },
      { id: 'threshold_agent', label: 'Threshold', pattern: /^threshold_agent/ },
      { id: 'unittest_agent', label: 'Unittest', pattern: /^unittest_agent/ },
      { id: 'completion_check_agent', label: 'Completion Check', pattern: /^completion_check_agent/ },
      { id: 'fault_definer', label: 'Fault Definer' },
      { id: 'fault_scenario_agent', label: 'Fault Scenario' },
      { id: 'fault_refiner', label: 'Fault Refiner' },
    ],
  },
  {
    id: 'experiment_plan',
    label: 'Experiment Plan',
    agents: [
      { id: 'experiment_plan_agent', label: 'Planning' },
      { id: 'plan2workflow_converter', label: 'Workflow Conversion' },
    ],
  },
  {
    id: 'improvement_loop',
    label: 'Improvement Loop',
    agents: [],  // Dynamically generated based on completed/current agents
    dynamicAgents: true,
  },
  {
    id: 'postprocess',
    label: 'Summary',
    agents: [
      { id: 'summary_agent', label: 'Generating Report' },
    ],
  },
];

// Patterns for improvement_loop dynamic agents
export const IMPROVEMENT_LOOP_PATTERNS = {
  experiment: /^experiment_runner$/,
  analysis: /^analysis_\d+$/,
  improvement: /^improvement_\d+(_\d+)?$/,  // improvement_0 or improvement_0_1 (with retry)
};

/**
 * Check if an agent belongs to the improvement loop
 */
export function isImprovementLoopAgent(agentId: string): boolean {
  return (
    IMPROVEMENT_LOOP_PATTERNS.experiment.test(agentId) ||
    IMPROVEMENT_LOOP_PATTERNS.analysis.test(agentId) ||
    IMPROVEMENT_LOOP_PATTERNS.improvement.test(agentId)
  );
}

/**
 * Get the phase that contains a specific agent.
 */
export function getPhaseForAgent(agentId: string): string | null {
  // Check improvement_loop first (dynamic agents)
  if (isImprovementLoopAgent(agentId)) {
    return 'improvement_loop';
  }

  for (const phase of PHASE_CONFIG) {
    for (const agent of phase.agents) {
      if (agent.pattern) {
        if (agent.pattern.test(agentId)) {
          return phase.id;
        }
      } else if (agent.id === agentId) {
        return phase.id;
      }
    }
  }
  return null;
}
