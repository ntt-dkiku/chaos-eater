import os
import re
import glob
import subprocess
import time
import json
import shutil
import datetime
from typing import List
from jinja2 import Environment, FileSystemLoader

import aiofiles
import streamlit as st

from .schemas import File
from .wrappers import BaseModel


def remove_spaces(text: str) -> str:
    return "\n".join(list(map(str.strip, text.split("\n"))))

def write_file(fname: str, content: str) -> None:
    with open(fname, "w") as f:
        f.write(content)

async def write_file_async(path: str, content: str) -> None:
    async with aiofiles.open(path, 'w') as f:
        await f.write(content)

def read_file(fname: str) -> str:
    with open(fname, 'r') as f:
        content = f.read()
    return content

def copy_file(src_fname: str, dst_fname: str) -> None:
    os.makedirs(os.path.dirname(dst_fname), exist_ok=True)
    shutil.copy(src_fname, dst_fname)

def delete_file(path: str):
    if os.path.exists(path):
        os.remove(path)
        print(f"{path} has been deleted.")
    else:
        print(f"{path} does not exist.")

def copy_dir(source_path: str, destination_path: str) -> bool:
    try:
        if not os.path.exists(source_path):
            print(f"Error: Source directory '{source_path}' does not exist.")
            return False
        if os.path.exists(destination_path):
            print(f"Error: Destination directory '{destination_path}' already exists.")
            return False
        shutil.copytree(source_path, destination_path)
        print(f"Successfully copied '{source_path}' to '{destination_path}'.")
        return True
    except PermissionError:
        print("Error: Permission denied. Check your access rights.")
    except shutil.Error as e:
        print(f"Error: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    return False

def save_json(path: str, data: dict | list):
    with open(path, 'w') as f:
        json.dump(data, f, indent=4)

def load_json(path: str):
    with open(path, 'r') as f:
        loaded_data = json.load(f)
    return loaded_data

def save_jsonl(path, data):
    with open(path, 'w', encoding='utf-8') as file:
        for item in data:
            json_line = json.dumps(item, ensure_ascii=False)
            file.write(json_line + '\n')

def load_jsonl(path):
    data = []
    with open(path, 'r', encoding='utf-8') as file:
        for line in file:
            data.append(json.loads(line.strip()))
    return data

def recursive_to_dict(obj):
    if isinstance(obj, BaseModel):
        return {k: recursive_to_dict(v) for k, v in obj.dict().items()}
    elif isinstance(obj, dict):
        return {k: recursive_to_dict(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [recursive_to_dict(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(recursive_to_dict(item) for item in obj)
    elif hasattr(obj, '__dict__'):
        return recursive_to_dict(obj.__dict__)
    else:
        return obj

def extract_fname_wo_suffix(file_path: str) -> str:
    return os.path.splitext(os.path.basename(file_path))[0]

def remove_files_in(dir: str) -> None:
    for p in glob.glob(f'{dir}/**/*', recursive=True):
        if os.path.isfile(p):
            os.remove(p)

def remove_all(
    dir: str, 
    context: str,
    namespace: str
) -> None:
    from .k8s import remove_all_resources_by_namespace
    remove_files_in(dir)
    remove_all_resources_by_namespace(context, namespace)

def get_timestamp() -> str:
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

def get_pod_exit_code(pod_name: str, namespace: str = "default") -> int:
    cmd = ["kubectl", "get", "-n", namespace, "pod", pod_name, "-o", "json"]
    expander = st.sidebar.expander(" ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        assert False, f"Error executing kubectl command: {result.stderr}"
    
    pod_info = json.loads(result.stdout)
    container_statuses = pod_info.get("status", {}).get("containerStatuses", [])
    for container_status in container_statuses:
        state = container_status.get("state", {})
        terminated = state.get("terminated")
        if terminated:
            expander.write(terminated.get("exitCode"))
            return int(terminated.get("exitCode"))
    expander.write(container_statuses)
    assert False, f"{container_statuses}"

def type_cmd2(input: List[str], returncode: bool = False) -> str:
    with st.sidebar.expander(" ".join(input)):
        res = subprocess.run(input, capture_output=True, text=True)
        if returncode:
            st.write(res.returncode)
            return res.returncode
        if res.returncode == 0:
            st.write(limit_string_length(res.stdout))
        else:
            st.write(limit_string_length(res.stderr))
    return res

def type_cmd3(input: str) -> str:
    with st.sidebar.expander(input):
        res = subprocess.run(input, shell=True, capture_output=True, text=True)
        if res.returncode == 0:
            st.write(limit_string_length(res.stdout))
        else:
            st.write(limit_string_length(res.stderr))
    return res

def type_cmd(
    input: str,
    returncode: bool = False,
    widget: bool = True,
) -> str:
    res = subprocess.run(
        input,
        shell=True,
        capture_output=True,
        text=True,
    )
    if widget:
        with st.sidebar.expander(input):
            if returncode:
                st.write(res.returncode)
                if res.returncode == 0:
                    st.write(limit_string_length(res.stdout))
                else:
                    st.write(limit_string_length(res.stderr))
                return res.returncode
            result = res.stdout if res.returncode == 0 else res.stderr
            st.write(limit_string_length(result)) # TODO: should be removed?
    else:
        if returncode:
            return res.returncode
        result = res.stdout if res.returncode == 0 else res.stderr
    return result

def pseudo_streaming_text(
    text: str, 
    sleep_sec: float = 0.01,
    obj: st.empty = None,
    **kwargs
) -> None:
    if obj is None:
        elem = st.empty()
    else:
        elem = obj
    words = ""
    for word in list(text):
        words += word
        elem.write(words, **kwargs)
        time.sleep(sleep_sec)
    print(text)
    return elem

def file_to_str(file: File) -> str:
    return add_code_fences(file.content, file.fname)

def file_list_to_str(file_list: List[File]) -> str:
    file_list_str = ""
    for file in file_list:
        file_list_str += f"```{file.fname}\n{file.content}```\n"
    return file_list_str

def list_to_bullet_points(lst_str: List[str]) -> str:
    return "\n".join(f"- {item}" for item in lst_str)

def add_code_fences(code: str, header: str = ""):
    return f"```{header}\n{code}\n```"

def render_jinja_template(template_path: str, **kwargs) -> str:
    file_loader = FileSystemLoader(os.path.dirname(template_path))
    env = Environment(
        loader=file_loader,
        trim_blocks=False,
        lstrip_blocks=False,
        keep_trailing_newline=True
    )
    template = env.get_template(os.path.basename(template_path))
    rendered_unittest_template = template.render(**kwargs)
    return rendered_unittest_template

#-----------
# time unit
#-----------
def sum_time(time1: str, time2: str) -> str:
    time1_v = parse_time(time1)
    time2_v = parse_time(time2)
    res_v = time1_v + time2_v
    return add_timeunit(res_v)

def parse_time(time_str: str) -> int:
    pattern = r'(\d+)([smh])'
    matches = re.findall(pattern, time_str)
    total_seconds = 0
    if time_str == "0":
        return 0
    for value, unit in matches:
        value = int(value)
        if unit == 's':
            total_seconds += value
        elif unit == 'm':
            total_seconds += value * 60
        elif unit == 'h':
            total_seconds += value * 3600
        else:
            raise ValueError(f"Unsupported time unit: {unit}")
    return total_seconds

def add_timeunit(value: int) -> str:
    units = [
        (86400, 'd'),
        (3600, 'h'),
        (60, 'm'),
        (1, 's')
    ]
    if value == 0:
        return "0"
    result = []
    for unit_value, unit_symbol in units:
        if value >= unit_value:
            count = value // unit_value
            result.append(f"{count}{unit_symbol}")
            value %= unit_value
    return "".join(result)

def int_to_ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix_dict = {1: "st", 2: "nd", 3: "rd"}
        suffix = suffix_dict.get(n % 10, "th")
    return f"{n}{suffix}"

def dict_to_str(input: dict) -> str:
    return json.dumps(input).replace('{', '{{').replace('}', '}}')

def remove_curly_braces(text: str) -> str:
    return text.replace('{', '{{').replace('}', '}}')

def get_file_extension(path: str) -> str:
    _, ext = os.path.splitext(path)
    return ext

def sanitize_k8s_name(name: str) -> str:
    # Convert all characters to lowercase
    name = name.lower().replace(" ", "")
    # Replace disallowed characters with empty (only allow a-z, 0-9, and -)
    name = re.sub(r'[^a-z0-9-]', '', name)
    # Replace consecutive hyphens with a single hyphen
    name = re.sub(r'-+', '-', name)
    # Remove hyphens from the beginning and end of the name
    name = name.strip('-')
    # Set a default name if the resulting string is empty
    if not name:
        name = 'default-name'
    # Limit the name length to 63 characters
    if len(name) > 63:
        name = name[:63]
    return name

def sanitize_filename(filename: str) -> str:
    # Define a regular expression pattern to match invalid filename characters
    invalid_pattern = r'[<>:"/\\|?*\[\]]'  # These characters are not allowed in file names
    # Replace disallowed characters with empty
    filename = re.sub(invalid_pattern, '', filename)
    # Replace consecutive hyphens with a single hyphen
    filename = re.sub(r'-+', '-', filename)
    # Replace consecutive hyphens with a single hyphen
    filename = filename.replace(" ", "")
    # Remove hyphens from the beginning and end of the filename
    filename = filename.strip('-')
    # If the filename is empty after sanitization, set a default name
    if not filename:
        filename = 'default-filename'
    # Limit the filename length to 255 characters (common limit for most filesystems)
    if len(filename) > 255:
        filename = filename[:255]
    return filename

def limit_string_length(
    s: str,
    max_length: int = 3000, 
    suffix: str = '...'
) -> str:
    if len(suffix) >= max_length:
        return suffix
    if len(s) > max_length:
        half_length = (max_length - len(suffix)) // 2
        return s[:half_length] + suffix + s[-half_length:]
    else:
        return s

def is_binary(file_content) -> str:
    return b'\0' in file_content or any(byte > 127 for byte in file_content)


#---------------
# type commands
#---------------
from typing import Protocol, Callable, Optional, Any
import subprocess
import threading
from queue import Queue
import time
import functools
from abc import ABC, abstractmethod
class DisplayHandler(Protocol):
    """Protocol defining display handling interface for resource deletion process"""
    
    def on_start(self, cmd: str = "") -> Any:
        """Handle display initialization when process starts"""
        ...
    
    def on_output(self, output: str) -> None:
        """Handle output display during process execution"""
        ...
    
    def on_success(self) -> None:
        """Handle display when process completes successfully"""
        ...
    
    def on_error(self, error: str) -> None:
        """Handle display when process encounters an error"""
        ...

class CLIDisplayHandler:
    """Display handler implementation for Command Line Interface"""
    
    def __init__(self, header: str = ""):
        # Create empty containers for dynamic content updates
        print(header)

    def on_start(self, cmd: str = ""):
        """Display initial progress message"""
        print(f"$ {cmd}")
        
    def on_output(self, output: str):
        """Print output directly to console"""
        print(output, end='')
        
    def on_success(self, output: str = ""):
        """Display success message"""
        pass
        
    def on_error(self, error: str):
        """Display error message"""
        print(f"Error: {error}")

def with_display(display_handler: Optional[DisplayHandler] = None):
    """
    Decorator for injecting display handler into resource management functions
    
    Args:
        display_handler: Optional display handler instance. Defaults to CLIDisplayHandler
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Check if display_handler is provided in kwargs
            handler = kwargs.pop('display_handler', None) or display_handler or CLIDisplayHandler()
            kwargs['display_handler'] = handler
            return func(*args, **kwargs)
        return wrapper
    return decorator

def enqueue_output(out, queue):
    """
    Helper function to enqueue subprocess output
    
    Args:
        out: Subprocess output stream
        queue: Queue to store output lines
    """
    for line in iter(out.readline, b''):
        queue.put(line)
    out.close()

@with_display()
def run_command(
    cmd: str,
    cwd: str = ".",
    display_handler: DisplayHandler = CLIDisplayHandler()
) -> None:
    try:
        display_handler.on_start(cmd)
        
        # Start subprocess with pipe for real-time output
        process = subprocess.Popen(
            f"stdbuf -oL {cmd}",
            shell=True,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
            universal_newlines=True
        )
        
        # Set up output queue and monitoring thread
        q = Queue()
        t = threading.Thread(target=enqueue_output, args=(process.stdout, q))
        t.daemon = True
        t.start()
        
        # Process output in real-time
        all_output = []
        while True:
            try:
                line = q.get_nowait()
                if line:
                    all_output.append(line)
                    display_handler.on_output(line)
            except:
                if process.poll() is not None:
                    break

        # Check for errors
        if process.returncode != 0:
            error_output = process.stderr.read()
            if isinstance(error_output, bytes):
                error_output = error_output.decode('utf-8')
            display_handler.on_error(error_output)
            raise subprocess.CalledProcessError(process.returncode, cmd, error_output)
        
        display_handler.on_success("".join(all_output))

    except Exception as e:
        display_handler.on_error(str(e))
        raise RuntimeError(e)

class MessageLogger:
    def __init__(self):
        self.messages = []
    
    def save(self, filepath: str):
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.messages, f, ensure_ascii=False, indent=2)

class StreamDebouncer:
    def __init__(self, interval: float = 0):
        self.interval = interval
        self.last_update_time = 0

    def should_update(self) -> bool:
        current_time = time.time()
        if current_time - self.last_update_time >= self.interval:
            self.last_update_time = current_time
            return True
        return False
    
    def reset(self):
        self.last_update_time = 0