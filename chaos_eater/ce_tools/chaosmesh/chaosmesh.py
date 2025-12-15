from typing import List

from pydantic.v1 import BaseModel

from ..ce_tool_base import CEToolBase
from .faults.pod_chaos import PodChaos
from .faults.network_chaos import NetworkChaos
from .faults.dns_chaos import DNSChaos
from .faults.http_chaos import HTTPChaos
from .faults.stress_chaos import StressChaos
from .faults.io_chaos import IOChaos
from .faults.time_chaos import TimeChoas

# cited from https://chaos-mesh.org/docs/basic-features/ (ver. 2.6.2)
CHAOS_MESH_FAULTS = """\
- PodChaos: simulates Pod failures, such as Pod node restart, Pod's persistent unavailablility, and certain container failures in a specific Pod. The supported subtypes include 'pod-kill', 'container-kill'.
- NetworkChaos: simulates network failures, such as network latency, packet loss, packet disorder, and network partitions.
- DNSChaos: simulates DNS failures, such as the parsing failure of DNS domain name and the wrong IP address returned.
- HTTPChaos: simulates HTTP communication failures, such as HTTP communication latency.
- StressChaos: simulates CPU race or memory race.
- IOChaos: simulates the I/O failure of an application file, such as I/O delays, read and write failures.
- TimeChaos: simulates the time jump exception.
"""
# - KernelChaos: simulates kernel failures, such as an exception of the application memory allocation.


class ChaosMesh(CEToolBase):
    name = "Chaos Mesh"
    FACTORY_MAP = {
        "PodChaos": PodChaos,
        "NetworkChaos": NetworkChaos,
        "DNSChaos": DNSChaos,
        "HTTPChaos": HTTPChaos,
        "StressChaos": StressChaos,
        "IOChaos": IOChaos,
        "TimeChaos": TimeChoas
    }
    TEMPLATE_PATH = "chaos_eater/ce_tools/chaosmesh/templates/chaos_template.j2"

    def get_chaos_var_candidates(self) -> str:
        return CHAOS_MESH_FAULTS
    
    def get_docs(self, chaos_vars: List[str]) -> str:
        pass
        # return "\n".join([json.dumps(doc) for key, doc in get_chaosmesh_docs().items() if key in chaos_vars])
    
    def get_fault_params(self, fault_name: str) -> BaseModel:
        if fault_name in self.FACTORY_MAP:
            return self.FACTORY_MAP[fault_name]
        raise TypeError(f"Invalid fault type!: {fault_name}. Valid fault types are as follows: {list(self.FACTORY_MAP.keys())}")
    
    def get_template_path(self, fault_name: str) -> str:
        if fault_name in self.FACTORY_MAP:
            return self.TEMPLATE_PATH
        raise TypeError(f"Invalid fault type!: {fault_name}. Valid fault types are as follows: {list(self.FACTORY_MAP.keys())}")

    def get_workflow_format_name(self) -> str:
        return "Chaos Mesh Workflow file (YAML)"
    
    def get_workflow_file_suffix(self) -> str:
        return "yaml"

    def get_workflow_validation_condition(self) -> str:
        return f"The {self.get_workflow_format_name()} is validated via 'kubectl apply' with the 'server-dry-run' option."
    
    def extract_workflow(self, input_stream) -> str:
        return input_stream
    
    def fault_names(self) -> List[str]:
        return list(self.FACTORY_MAP.keys())