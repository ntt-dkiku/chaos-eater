"""CLI Message Logger for terminal output using rich."""
from typing import Literal, Optional
from rich.console import Console
from rich.live import Live
from rich.text import Text
from rich.syntax import Syntax
from ..utils.functions import MessageLogger


class CLIMessageLogger(MessageLogger):
    """Message logger using rich for beautiful terminal output."""

    def __init__(self):
        super().__init__()
        self.console = Console()
        self._live: Optional[Live] = None
        self._live_content = ""

    def _end_live(self):
        """End any active live display."""
        if self._live is not None:
            self._live.stop()
            self._live = None
            self._live_content = ""

    def write(self, text: str, role: Literal["user", "assistant"] = "assistant") -> None:
        """Output plain text message."""
        self._end_live()
        self.messages.append({"type": "write", "role": role, "text": text})

        # Handle markdown headers
        if text.startswith("#"):
            header_text = text.lstrip('#').strip()
            level = len(text) - len(text.lstrip('#'))
            style = "bold cyan" if level <= 3 else "yellow"
            self.console.print(f"\n{header_text}", style=style)
        else:
            self.console.print(text)

    def subheader(self, text: str, divider: str, role: Literal["user", "assistant"] = "assistant") -> None:
        """Output section header."""
        self._end_live()
        self.messages.append({"type": "subheader", "role": role, "text": text, "divider": divider})
        self.console.rule(text, style="bold cyan")

    def code(self, code: str, language: str | None = None,
             role: Literal["user", "assistant"] = "assistant", filename: str = "") -> None:
        """Output code block."""
        self._end_live()
        self.messages.append({
            "type": "code", "role": role, "code": code,
            "language": language, "filename": filename
        })

        if filename:
            self.console.print(f"[dim][{filename}][/dim]")
        syntax = Syntax(code, language or "text", theme="monokai", line_numbers=False)
        self.console.print(syntax)

    def stream(self, chunk: str, role: Literal["user", "assistant"] = "assistant",
               mode: Literal["delta", "frame"] = "frame",
               format: Literal["plain", "code"] = "plain",
               language: Optional[str] = None, filename: str = "",
               final: bool = False) -> None:
        """Stream content using rich Live display."""
        self.messages.append({
            "type": "partial", "role": role, "partial": chunk,
            "mode": mode, "format": format, "language": language,
            "filename": filename, "final": final
        })

        # Live display handles accumulated content automatically
        if self._live is None:
            self._live = Live(console=self.console, refresh_per_second=10)
            self._live.start()

        # Update content (rich handles the diff internally)
        self._live_content = chunk
        if format == "code":
            renderable = Syntax(chunk, language or "shell", theme="monokai")
        else:
            renderable = Text(chunk)
        self._live.update(renderable)

        if final:
            self._end_live()

    def iframe(self, url: str, role: Literal["user", "assistant"] = "assistant") -> None:
        """Output URL reference."""
        self._end_live()
        self.messages.append({"type": "iframe", "role": role, "url": url})
        self.console.print(f"[cyan][Link: {url}][/cyan]")

    def tag(self, text: str, color: str, background: str,
            role: Literal["user", "assistant"] = "assistant") -> None:
        """Output tag/badge."""
        self._end_live()
        self.messages.append({
            "type": "tag", "role": role, "text": text,
            "color": color, "background": background
        })
        self.console.print(f"[green][{text}][/green]")
