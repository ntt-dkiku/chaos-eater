from typing import List, Optional, Literal
from pydantic.v1 import BaseModel, Field
from .selectors import Selectors


# ref: https://chaos-mesh.org/docs/simulate-heavy-stress-on-kubernetes/#memorystressor
class MemoryStressor(BaseModel):
    workers: Optional[int] = Field(
        default=None,
        example=1,
        description="Specifies the number of threads that apply memory stress"
    )
    size: Optional[str] = Field(
        default=None,
        example="256MB",
        description="Specifies the memory size to be occupied or a percentage of the total memory size. The final sum of the occupied memory size is size."
    )
    # time: Optional[str] = Field(
    #     default=None,
    #     example="10min",
    #     description="Specifies the time to reach the memory size. The growth model is a linear model."
    # )
    oomScoreAdj: Optional[int] = Field(
        default=None,
        example=-1000,
        description="Specifies the oom_score_adj of the stress process."
    )

class CPUStressor(BaseModel):
    workers: int = Field(
        default=None,
        example=1,
        description="Specifies the number of threads that apply CPU stress"
    )
    load: int = Field(
        default=None,
        example=50,
        description="Specifies the percentage of CPU occupied. 0 means that no additional CPU is added, and 100 refers to full load. The final sum of CPU load is workers * load."
    )

class Stressors(BaseModel):
    memory: Optional[MemoryStressor] = Field(
        default=None,
        description="Specifies the memory stress"
    )
    cpu: Optional[CPUStressor] = Field(
        default=None,
        description="Specifies the CPU stress"
    )

class StressChaos(BaseModel):
    # duration: str = Field(
    #     example="30s",
    #     description="Specifies the duration of the experiment."
    # )
    mode: Literal["one", "all", "fixed", "fixed-percent", "random-max-percent"] = Field(
        example="one",
        description="Specifies the mode of the experiment. The mode options include 'one' (selecting a random Pod), 'all' (selecting all eligible Pods), 'fixed' (selecting a specified number of eligible Pods), 'fixed-percent' (selecting a specified percentage of Pods from the eligible Pods), and 'random-max-percent' (selecting the maximum percentage of Pods from the eligible Pods)"
    )
    value: Optional[str] = Field(
        default=None, 
        example="1", 
        description="Provides parameters for the mode configuration, depending on mode.For example, when mode is set to fixed-percent, value specifies the percentage of Pods."
    )
    stressors: Optional[Stressors] = Field(
        dafault=None,
        description="Specifies the stress of CPU or memory"
    )
    stressngStressors: Optional[str] = Field(
        default=None,
        example="--clone 2",
        description="Specifies the stres-ng parameter to reach richer stress injection"
    )
    containerNames: Optional[List[str]] = Field(
        default=None,
        example=["nginx"],
        description="Specifies the name of the container into which the fault is injected."
    )
    selector: Selectors = Field(
        description="Specifies the target Pod."
    )