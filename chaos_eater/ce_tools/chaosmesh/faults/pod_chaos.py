from typing import List, Optional, Literal
from pydantic.v1 import BaseModel, Field
from .selectors import Selectors


# ref: from https://chaos-mesh.org/docs/simulate-pod-chaos-on-kubernetes/ (ver. 2.6.2)
class PodChaos(BaseModel):
    action: Literal["pod-kill", "container-kill"] = Field(
        example="pod-kill",
        description="Specifies the fault type from 'pod-kill', or 'container-kill'."
    )
    mode: Literal["one", "all", "fixed", "fixed-percent", "random-max-percent"] = Field(
        example="one",
        description="Specifies the mode of the experiment. The mode options include 'one' (selecting a random Pod), 'all' (selecting all eligible Pods), 'fixed' (selecting a specified number of eligible Pods), 'fixed-percent' (selecting a specified percentage of Pods from the eligible Pods), and 'random-max-percent' (selecting the maximum percentage of Pods from the eligible Pods)"
    )
    value: Optional[str] = Field(
        default=None,
        example="1",
        description="Provides parameters for the mode configuration, depending on mode.For example, when mode is set to fixed-percent, value specifies the percentage of Pods."
    )
    selector: Selectors = Field(
        example=None,
        description="Specifies the target Pod."
    )
    containerNames: Optional[List[str]] = Field(
        default=None,
        example=["prometheus"],
        description="When you configure action to container-kill, this configuration is mandatory to specify the target container name for injecting faults."
    )
    # Grace Period is determined in experiment planning
    # gracePeriod: Optional[int] = Field(
    #     default=0,
    #     example=0,
    #     description="When you configure action to pod-kill, this configuration is mandatory to specify the duration before deleting Pod."
    # )
    # duration: str = Field(
    #     default=None,
    #     example="30s",
    #     description="Specifies the duration of the pod-chaos injection."
    # )
# Note that you may select 'pod-failure' only when the target Pod's container has livenessProbe and readinessProbe defined.