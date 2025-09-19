from typing import Literal, Callable, Dict, Any, List, Optional
from ..utils.functions import MessageLogger, limit_string_length


StreamEmitter = Callable[[Dict[str, Any]], None]


class FrontendMessageLogger(MessageLogger):
    """
    A logger that accumulates writes to the regular history while immediately streaming to WebSocket.
    It sends structured events to the emitter (= APICallback.on_stream) passed via set_emitter.
    """
    def __init__(
        self,
        emitter: StreamEmitter | None = None
    ) -> None:
        super().__init__()
        self._emit: StreamEmitter | None = emitter

    def set_emitter(self, emitter: StreamEmitter) -> None:
        self._emit = emitter

    def _push(self, event: Dict[str, Any]) -> None:
        self.messages.append(event)
        if self._emit:
            self._emit(event)

    def write(
        self,
        text: str,
        role: Literal["user", "assistant"] = "assistant"
    ) -> None:
        self._push({
            "type": "write",
            "role": role,
            "text": text
        })

    def code(
        self,
        code: str,
        language: str | None = None,
        role: Literal["user", "assistant"] = "assistant",
        filename: str = ""
    ) -> None:
        self._push({
            "type": "code",
            "role": role,
            "code": code,
            "language": language,
            "filename": filename
        })

    def subheader(
        self,
        text: str,
        divider: str,
        role: Literal["user", "assistant"] = "assistant"
    ) -> None:
        self._push({
            "type": "subheader",
            "role": role,
            "text": text,
            "divider": divider
        })

    def stream(
        self,
        chunk: str,
        role: Literal["user", "assistant"] = "assistant",
        mode: Literal["delta", "frame"] = "frame",
        format: Literal["plain", "code"] = "plain",
        language: Optional[str] = None,
        filename: str = "",
        final: bool = False
    ) -> None:
        self._push({
            "type": "partial",
            "role": role,
            "partial": chunk,
            "mode": mode,
            "format": format,
            "language": language,
            "filename": filename,
            "final": final
        })

class FrontEndDisplayHandler:
    """Display handler implementation for Streamlit UI"""
    
    def __init__(
        self,
        message_logger: FrontendMessageLogger,
        header: str = ""
    ):
        self.message_logger = message_logger
        # Create empty containers for dynamic content updates
        self.message_logger.write(header)
        self.idx = -1
        self.cmd = []
        self.output_text = []

    def on_start(self, cmd: str = ""):
        """Initialize display with progress status"""
        self.cmd.append(limit_string_length(cmd))
        self.output_text.append("")
        self.idx += 1
        output_text = ""
        for i in range(len(self.cmd)):
            if i < len(self.cmd) - 1:
                output_text += f"$ {self.cmd[i]}\n\n{self.output_text[i]}"
            else:
                output_text += f"$ {self.cmd[i]}"
        self.message_logger.stream(
            output_text,
            format="code",
            language="powershell"
        )
        return

    def on_output(self, output: str):
        """Update output container with new content"""
        if output != "":
            self.output_text[self.idx] += output
            self.output_text[self.idx] = limit_string_length(self.output_text[self.idx])
        output_text = ""
        for i in range(len(self.cmd)):
            output_text += f"$ {self.cmd[i]}\n\n{self.output_text[i]}"
        self.message_logger.stream(
            output_text,
            format="code",
            language="powershell"
        )

    def on_success(self, output: str = ""):
        """Update status to show successful completion"""
        if output != "":
            output_text = ""
            for i in range(self.idx):
                output_text += f"$ {self.cmd[i]}\n{self.output_text[i]}"
            self.output_text[self.idx] = limit_string_length(output)
            output_text += f"$ {self.cmd[self.idx]}\n\n{self.output_text[self.idx]}"
            self.message_logger.stream(
                output_text,
                format="code",
                language="powershell"
            )

    def on_error(self, error: str):
        """Update status and output to show error details"""
        output_text_tmp = f"Error: {error}"
        self.output_text[self.idx] += limit_string_length(output_text_tmp)
        output_text = ""
        for i in range(len(self.cmd)):
            output_text += f"$ {self.cmd[i]}\n\n{self.output_text[i]}"
        self.message_logger.stream(
            output_text,
            format="code",
            language="powershell"
        )