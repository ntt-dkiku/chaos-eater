from typing import Literal, Callable, Dict, Any, List
from ..utils.functions import MessageLogger


StreamEmitter = Callable[[Dict[str, Any]], None]


class FrontendMessageLogger(MessageLogger):
    """
    書き込みを通常の履歴に蓄積しつつ、即座に WebSocket へ流す用のロガー。
    set_emitter で渡された emitter(= APICallback.on_stream) に
    構造化イベントを投げます。
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
        role: Literal["user", "assistant"] = "assistant"
    ) -> None:
        self._push({
            "type": "code",
            "role": role,
            "code": code,
            "language": language
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

    def stream_partial(
        self,
        chunk: str,
        role: Literal["user", "assistant"] = "assistant"
    ) -> None:
        self._push({
            "type": "partial",
            "role": role,
            "partial": chunk
        })
