from typing import List, Optional, Literal
from pydantic.v1 import BaseModel, Field
from .selectors import Selectors

# TODO: clockIds (https://man7.org/linux/man-pages/man2/clock_gettime.2.html)
# ref: https://chaos-mesh.org/docs/simulate-time-chaos-on-kubernetes/
class TimeChoas(BaseModel):
    timeOffset: str = Field(
        example="-5m",
        description="Specifies the length of time offset."
    )
    clockIds: Optional[List[str]] = Field(
        default=["CLOCK_REALTIME"],
        example=["CLOCK_REALTIME", "CLOCK_MONOTONIC"],
        description="Specifies the ID of clock that will be offset. See the clock_gettime documentation for details."
    )
    mode: Literal["one", "all", "fixed", "fixed-percent", "random-max-percent"] = Field(
        example="one",
        description="Specifies the mode of the experiment. The mode options include 'one' (selecting a random Pod), 'all' (selecting all eligible Pods), 'fixed' (selecting a specified number of eligible Pods), 'fixed-percent' (selecting a specified percentage of Pods from the eligible Pods), and 'random-max-percent' (selecting the maximum percentage of Pods from the eligible Pods)"
    )
    value: Optional[str] = Field(
        default=None,
        example="1",
        description="Provides parameters for the mode configuration, depending on mode. For example, when mode is set to fixed-percent, value specifies the percentage of Pods."
    )
    containerNames: Optional[List[str]] = Field(
        default=None,
        example=["nginx"],
        description="Specifies the name of the container into which the fault is injected."
    )
    selector: Selectors = Field(
        example=None,
        description="Specifies the target Pod."
    )