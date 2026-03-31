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
  dynamicSteadyStateAgents?: boolean;  // For hypothesis phase with dynamic steady state agents
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
      // Dynamic steady state agents (draft, inspection, threshold, unittest, completion_check) are inserted here
      { id: 'fault_definer', label: 'Fault Definer' },
      { id: 'fault_scenario_agent', label: 'Fault Scenario' },
      { id: 'fault_refiner', label: 'Fault Refiner' },
    ],
    dynamicSteadyStateAgents: true,
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
  replanning: /^replanning_\d+$/,
};

// Patterns for steady state dynamic agents in hypothesis phase
export const STEADY_STATE_PATTERNS = {
  draft: /^draft_agent_(\d+)$/,
  inspection: /^inspection_agent_(\d+)$/,
  threshold: /^threshold_agent_(\d+)$/,
  unittest: /^unittest_agent_(\d+)$/,
  completion_check: /^completion_check_agent_(\d+)$/,
};

/**
 * Check if an agent is a steady state proposal agent
 */
export function isSteadyStateAgent(agentId: string): boolean {
  return (
    STEADY_STATE_PATTERNS.draft.test(agentId) ||
    STEADY_STATE_PATTERNS.inspection.test(agentId) ||
    STEADY_STATE_PATTERNS.threshold.test(agentId) ||
    STEADY_STATE_PATTERNS.unittest.test(agentId) ||
    STEADY_STATE_PATTERNS.completion_check.test(agentId)
  );
}

/**
 * Check if an agent belongs to the improvement loop
 */
export function isImprovementLoopAgent(agentId: string): boolean {
  return (
    IMPROVEMENT_LOOP_PATTERNS.experiment.test(agentId) ||
    IMPROVEMENT_LOOP_PATTERNS.analysis.test(agentId) ||
    IMPROVEMENT_LOOP_PATTERNS.improvement.test(agentId) ||
    IMPROVEMENT_LOOP_PATTERNS.replanning.test(agentId)
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

  // Check steady state agents (hypothesis phase)
  if (isSteadyStateAgent(agentId)) {
    return 'hypothesis';
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
