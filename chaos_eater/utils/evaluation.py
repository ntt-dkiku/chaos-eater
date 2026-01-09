"""Utilities for evaluating ChaosEater outputs."""
from typing import Tuple, Any, Dict, Optional, List

from .functions import load_json


def get_tokens_from_logs(logs: Dict[str, Any], phase_name: str) -> Tuple[int, int, int]:
    """Extract token counts from logs dict.

    Args:
        logs: Logs dictionary from ChaosEater output
        phase_name: Name of the phase (e.g., "preprocess", "hypothesis")

    Returns:
        Tuple of (input_tokens, output_tokens, total_tokens)
    """
    phase_logs = logs.get(phase_name, [])
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0

    for log in phase_logs:
        if isinstance(log, list):
            for log_ in log:
                if isinstance(log_, dict):
                    token_usage = log_.get("token_usage", {})
                    input_tokens += token_usage.get("input_tokens", 0)
                    output_tokens += token_usage.get("output_tokens", 0)
                    total_tokens += token_usage.get("total_tokens", 0)
        elif isinstance(log, dict):
            token_usage = log.get("token_usage", {})
            input_tokens += token_usage.get("input_tokens", 0)
            output_tokens += token_usage.get("output_tokens", 0)
            total_tokens += token_usage.get("total_tokens", 0)

    return input_tokens, output_tokens, total_tokens


def get_runtime_from_dict(run_time: Dict[str, Any], phase_name: str) -> float:
    """Extract runtime from run_time dict.

    Args:
        run_time: Run time dictionary from ChaosEater output
        phase_name: Name of the phase

    Returns:
        Runtime in seconds (summed if list)
    """
    rt = run_time.get(phase_name, 0)
    if isinstance(rt, list):
        return sum(rt)
    return rt if rt else 0


class CEOutputWrapper:
    """Wrapper to handle both old and new ChaosEaterOutput formats.

    Old format: Has 'logs' at root level
    New format: No 'logs', only 'ce_cycle' and 'run_time'

    Usage:
        ce_output = CEOutputWrapper("path/to/output.json")
        tokens = ce_output.get_tokens("preprocess")
        runtime = ce_output.get_runtime("hypothesis")
        if ce_output.processed_data is not None:
            ...
    """

    def __init__(self, path: str):
        """Load ChaosEater output from JSON file.

        Args:
            path: Path to the output.json file
        """
        self.path = path
        self.data = load_json(path)
        self.logs = self.data.get("logs", {})
        self.run_time = self.data.get("run_time", {})
        self.ce_cycle = self.data.get("ce_cycle", {})

    def get_tokens(self, phase_name: str) -> Tuple[int, int, int]:
        """Get token counts for a phase."""
        return get_tokens_from_logs(self.logs, phase_name)

    def get_runtime(self, phase_name: str) -> float:
        """Get runtime for a phase."""
        return get_runtime_from_dict(self.run_time, phase_name)

    # ce_cycle accessors
    @property
    def processed_data(self) -> Optional[Dict]:
        """Get processed_data from ce_cycle."""
        return self.ce_cycle.get("processed_data")

    @property
    def hypothesis(self) -> Optional[Dict]:
        """Get hypothesis from ce_cycle."""
        return self.ce_cycle.get("hypothesis")

    @property
    def experiment(self) -> Optional[Dict]:
        """Get experiment from ce_cycle."""
        return self.ce_cycle.get("experiment")

    @property
    def completes_reconfig(self) -> bool:
        """Check if reconfiguration completed."""
        return self.ce_cycle.get("completes_reconfig", False)

    @property
    def analysis_history(self) -> List[Dict]:
        """Get analysis history."""
        return self.ce_cycle.get("analysis_history", [])

    @property
    def reconfig_history(self) -> List[Dict]:
        """Get reconfiguration history."""
        return self.ce_cycle.get("reconfig_history", [])

    @property
    def result_history(self) -> List[Dict]:
        """Get result history."""
        return self.ce_cycle.get("result_history", [])

    @property
    def conducts_reconfig(self) -> bool:
        """Check if reconfiguration was conducted."""
        return self.ce_cycle.get("conducts_reconfig", False)

    @property
    def summary(self) -> str:
        """Get summary."""
        return self.ce_cycle.get("summary", "")

    @property
    def cycle_runtime(self) -> Optional[float]:
        """Get total cycle runtime."""
        return self.run_time.get("cycle")
