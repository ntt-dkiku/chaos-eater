from typing import List, Literal, Optional
from pydantic.v1 import BaseModel, Field
from .selectors import Selectors


# ref: https://chaos-mesh.org/docs/simulate-dns-chaos-on-kubernetes/
class DNSChaos(BaseModel):
    action: Literal["random", "error"] = Field(
        default=None,
        example="random",
        description="Defines the behavior of DNS fault from 'random' or 'error'. When the value is random, DNS service returns a random IP address; when the value is error, DNS service returns an error."
    )
    mode: Literal["one", "all", "fixed", "fixed-percent", "random-max-percent"] = Field(
        default=None,
        example="one",
        description="Specifies the mode of the experiment. The mode options include 'one' (selecting a random Pod), 'all' (selecting all eligible Pods), 'fixed' (selecting a specified number of eligible Pods), 'fixed-percent' (selecting a specified percentage of Pods from the eligible Pods), and 'random-max-percent' (selecting the maximum percentage of Pods from the eligible Pods)"
    )
    value: Optional[str] = Field(
        default=None,
        example="1",
        description="Provides parameters for the mode configuration, depending on mode. For example, when mode is set to fixed-percent, value specifies the percentage of Pods."
    )
    patterns: Optional[List[str]] = Field(
        default=None,
        example="google.com, chaos-mesh.org, github.com",
        description="Selects a domain template that matches faults. The fault is applyed to these domains. Placeholder ? and wildcard * are supported, but the wildcard in patterns configuration must be at the end of string. For example, chaos-mes*.org. is an invalid configuration. When patterns is not configured, faults are injected for all domains."
    )
    selector: Selectors = Field(
        example=None,
        description="Specifies the target Pod."
    )