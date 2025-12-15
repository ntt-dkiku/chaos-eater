from typing import Optional, Literal, List, Dict
from pydantic.v1 import BaseModel, Field


# ref: https://chaos-mesh.org/docs/simulate-http-chaos-on-kubernetes/ 
class Replace(BaseModel):
    headers: Optional[Dict[str, str]] = Field(
        example={"Content-Type": "application/xml"},
        description="Specifies the key pair used to replace the request headers or response headers."
    )
    body: Optional[str] = Field(
        example="eyJmb28iOiAiYmFyIn0K",
        description="Specifies request body or response body to replace the fault (Base64 encoded)."
    )
    path: Optional[str] = Field(
        example="/api/v2",
        description="Specifies the URI path used to replace content."
    )
    method: Optional[str] = Field(
        example="DELETE",
        description="Specifies the replaced content of the HTTP request method."
    )
    queries: Optional[List[List[str]]] = Field(
        description="Specifies the replaced key pair of the URI query."
    )
    code: Optional[int] = Field(
        default=None,
        example=404,
        description="Specifies the replaced content of the response status code. This configuration is effective only when the 'target' is set to 'Response'."
    )

class PatchBody(BaseModel):
    type: Optional[str] = Field(
        default=None,
        example="JSON",
        description="Specifies the type of patch faults of the request body or response body. Currently, it only supports JSON."
    )
    value: Optional[str] = Field(
        default=None,
        example='{"foo": "bar"}',
        description="Specifies the fault of the request body or response body with patch faults."
    )

class Patch(BaseModel):
    headers: Optional[List[List[str]]] = Field(
        default=None,
        example=[["Set-Cookie", "one cookie"]],
        description="Specifies the attached key pair of the request headers or response headers with patch faults."
    )
    body: Optional[PatchBody] = Field(
        default=None,
        description="Patch body."
    )
    queries: Optional[List[List[str]]] = Field(
        default=None,
        example=[["foo", "bar"]],
        description="Specifies the attached key pair of the URI query with patch faults."
    )

class HTTPChaos(BaseModel):
    mode: Literal["one", "all", "fixed", "fixed-percent", "random-max-percent"] = Field(
        example="one",
        description="Specifies the mode of the experiment. The mode options include one (selecting a random Pod), all (selecting all eligible Pods), fixed (selecting a specified number of eligible Pods), fixed-percent (selecting a specified percentage of Pods from the eligible Pods), and random-max-percent (selecting the maximum percentage of Pods from the eligible Pods)"
    )
    value: Optional[str] = Field(
        default=None,
        example="1",
        description="Provides parameters for the mode configuration, depending on mode. For example, when mode is set to fixed-percent, value specifies the percentage of Pods."
    )
    target: Literal["Request", "Response"] = Field(
        example="Request",
        description="Specifies whether the target of fault injection is Request or Response. The target-related fields (replace.path, replace.method, replace.queries, patch.queries) should be configured at the same time."
    )
    port: int = Field(
        example=80,
        description="The TCP port that the target service listens on."
    )
    code: Optional[int] = Field(
        default=None,
        example=200,
        description="Specifies the status code responded by target. If not specified, the fault takes effect for all status codes by default. This configuration is effective only when the 'target' is set to 'Response'"
    )
    path: Optional[str] = Field(
        default=None,
        example="/api/*",
        description="Specify the URI path of the target request. Supports Matching wildcards. If not specified, the fault takes effect on all paths by default."
    )
    method: Optional[str] = Field(
        default=None,
        example="GET", 
        description="Specify the HTTP method of the target request method. If not specified, the fault takes effect for all methods by default."
    )
    request_headers: Optional[Dict[str, str]] = Field(
        default=None,
        example={"Content-Type": "application/json"},
        description="Matches request headers to target."
    )

    #-------------
    # fault types
    #-------------
    abort: Optional[bool] = Field(
        default=False,
        example=True,
        description="Abort fault. Indicates whether to inject the fault that interrupts the connection."
    )
    delay: Optional[str] = Field(
        default="0",
        example="10s",
        description="Deplay fault. Specifies the time for a latency fault."
    )
    replace: Optional[Replace] = Field(
        description="Replace fault. Specifies replaced contents."
    )
    patch: Optional[Patch] = Field(
        description="Patch fault. Specifies patch contents."
    )

    #----------
    # schedule
    #----------
    # duration: str = Field(
    #     default=None,
    #     example="30s",
    #     description="Specifies the duration of a specific experiment."
    # )
    # scheduler: Optional[str] = Field(
    #     default=None,
    #     example="5 * * * *",
    #     description="Specifies the scheduling rules for the time of a specific experiment."
    # )

    #------------------------
    # TODO: support TLS mode
    #------------------------