from typing import List, Optional, Literal
from pydantic.v1 import BaseModel, Field
from .selectors import Selectors


# ref: https://chaos-mesh.org/docs/simulate-io-chaos-on-kubernetes/
class TimeSpec(BaseModel):
    sec: Optional[int] = Field(
        default=None,
        description="Timestamp in seconds. Specify either sec or nsec."
    )
    nsec: Optional[int] = Field(
        default=None,
        description="Timestamp in nanoseconds. Specify either sec or nsec."
    )

class AttrOverrideSpec(BaseModel):
    ino: Optional[int] = Field(
        default=None,
        description="ino number"
    )
    size: Optional[int] = Field(
        default=None,
        description="File size"
    )
    blocks: Optional[int] = Field(
        default=None,
        description="Number of blocks that the file uses"
    )
    atime: Optional[TimeSpec] = Field(
        default=None,
        description="Last access time"
    )
    mtime: Optional[TimeSpec] = Field(
        default=None,
        description="Last modified time"
    )
    ctime: Optional[TimeSpec] = Field(
        default=None,
        description="Last status change time"
    )
    kind: Optional[str] = Field(
        default=None,
        description="File type, see fuser::FileType"
    )
    perm: Optional[int] = Field(
        default=None,
        description="File permissions in decimal"
    )
    nlink: Optional[int] = Field(
        default=None,
        description="Number of hard links"
    )
    uid: Optional[int] = Field(
        default=None,
        description="User ID of the owner"
    )
    gid: Optional[int] = Field(
        default=None,
        description="Group ID of the owner"
    )
    rdev: Optional[int] = Field(
        default=None,
        description="Device ID"
    )

class MistakeSpec(BaseModel):
    filling: str = Field(
        description="The wrong data to be filled. Only zero (fill 0) or random (fill random bytes) are supported."
    )
    maxOccurrences: int = Field(
        example=1,
        description="Maximum number of errors in each operation."
    )
    maxLength: int = Field(
        example=1,
        description="Maximum length of each error (in bytes)."
    ) 

class IOChaos(BaseModel):
    action: Literal["latency", "fault", "attrOverride", "mistake"] = Field(
        example="latency",
        description="Indicates the specific type of faults. Only latency, fault, attrOverride, and mistake are supported."
    )
    mode: Literal["one", "all", "fixed", "fixed-percent", "random-max-percent"] = Field(
        example="one",
        description="Specifies the mode of the experiment. The mode options include one (selecting a random Pod), all (selecting all eligible Pods), fixed (selecting a specified number of eligible Pods), fixed-percent (selecting a specified percentage of Pods from the eligible Pods), and random-max-percent (selecting the maximum percentage of Pods from the eligible Pods)"
    )
    selector: Selectors = Field(
        default=None,
        description="Specifies the target Pod."
    )
    value: Optional[str] = Field(
        default=None,
        example="1",
        description="Provides parameters for the mode configuration, depending on mode. For example, when mode is set to fixed-percent, value specifies the percentage of Pods."
    )
    volumePath: str = Field(
        example="/var/run/etcd",
        description="The mount point of volume in the target container. Must be the root directory of the mount."
    )
    path: Optional[str] = Field(
        default=None,
        example="/var/run/etcd/*/",
        description="The valid range of fault injections, either a wildcard or a single file. If not specified, the fault is valid for all files by default"
    )
    methods: Optional[List[str]] = Field(
        default=None,
        example=["READ"],
        description="Type of the file system call that requires injecting fault. Supported method types: ['lookup', 'forget', 'getattr', 'setattr', 'readlink', 'mknod', 'mkdir', 'unlink', 'rmdir', 'symlink', 'rename', 'link', 'open', 'read', 'write', 'flush', 'release', 'fsync', 'opendir', 'readdir', 'releasedir', 'fsyncdir', 'statfs', 'setxattr', 'getxattr', 'listxattr', 'removexattr', 'access', 'create', 'getlk', 'setlk', 'bmap']. All Types by default."
    )
    percent: Optional[int] = Field(
        default=100,
        example=100,
        description="Probability of failure per operation, in %."
    )
    containerNames: Optional[List[str]] = Field(
        default=None,
        description="Specifies the name of the container into which the fault is injected."
    )
    # duration: str = Field(
    #     example="30s",
    #     description="Specifies the duration of the experiment."
    # )
    deplay: Optional[str] = Field(
        description="Specify when the 'action' is set to 'latency'. Specific delay time."
    )
    errno: Optional[int] = Field(
        description="Specify when the 'action' is set to 'fault'. Returned error number: 1: Operation not permitted, 2: No such file or directory, 5: I/O error, 6: No such device or address, 12: Out of memory, 16: Device or resource busy, 17: File exists, 20: Not a directory, 22: Invalid argument, 24: Too many open files, 28: No space left on device"
    )
    attr: AttrOverrideSpec = Field(
        description="Specify when the 'action' is set to 'attrOverride'. Specific property override rules."
    )
    mistake: MistakeSpec = Field(
        description="Specify when the 'action' is set to 'mistake'. Specific error rules."
    )