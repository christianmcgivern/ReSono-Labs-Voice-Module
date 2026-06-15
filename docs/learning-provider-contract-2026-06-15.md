# Learning Provider Contract For The Voice Module

Date: 2026-06-15

This is the implementation companion to `learning-systems-honcho-hermes-2026-06-15.md`. It maps the Honcho/Hermes learning patterns into the current ReSono Voice Module structure.

Current module files reviewed:

- `backend/app/main.py`
- `backend/app/realtime.py`
- `backend/app/tools.py`
- `backend/app/data_store.py`
- `backend/app/schemas.py`

## Current module boundary

The module currently has a clean live-data boundary:

- `data_store.py` defines `DataStoreAdapter.search()` and an in-memory sample implementation.
- `tools.py` exposes `query_data_store` as a fresh backend lookup.
- `realtime.py` builds the Realtime session config and tool definitions.
- `main.py` creates sessions and executes tool calls.

Do not merge long-term learning into `DataStoreAdapter`. That adapter should stay responsible for fresh application data lookup. Learning needs a separate provider so stale learned context cannot be confused with live email/calendar/radar/news results.

## Recommended file layout

When implementation starts, add:

```text
backend/app/learning.py          Provider protocol, null provider, event/context models
backend/app/learning_hooks.py    Helpers called from session/tool lifecycle routes
docs/learning-provider-contract-2026-06-15.md
docs/learning-systems-honcho-hermes-2026-06-15.md
```

Optional later:

```text
backend/app/learning_sqlite.py   Local development provider
backend/app/learning_vault.py    Vault provider
backend/app/learning_cloud.py    Cloud provider
```

## Python protocol

The Voice Module backend is Python/FastAPI, so use a Python `Protocol` first.

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol


LearningScope = Literal["global", "surface", "signal", "automation", "session"]
LearningSensitivity = Literal["low", "private", "secret"]


@dataclass(frozen=True, slots=True)
class LearningContextBlock:
    scope: LearningScope
    text: str
    source: str
    retrieved_at: str
    signal_id: str | None = None
    max_age_seconds: int | None = None


@dataclass(frozen=True, slots=True)
class LearningEvent:
    event_id: str
    event_type: str
    session_id: str
    occurred_at: str
    user_id: str | None = None
    agent_id: str | None = None
    signal_id: str | None = None
    surface: str = "browser"
    sensitivity: LearningSensitivity = "private"
    payload: dict[str, Any] = field(default_factory=dict)
    trace_id: str | None = None


@dataclass(frozen=True, slots=True)
class LearningTurn:
    session_id: str
    user_text: str
    assistant_text: str
    completed_at: str
    user_id: str | None = None
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    trace_id: str | None = None


class LearningProvider(Protocol):
    async def is_available(self) -> bool:
        ...

    async def initialize(self, *, session_id: str, user_id: str | None, surface: str) -> None:
        ...

    async def startup_context(self, *, session_id: str, user_id: str | None) -> list[LearningContextBlock]:
        ...

    async def prefetch(self, *, query: str, session_id: str, user_id: str | None, signal_id: str | None = None) -> list[LearningContextBlock]:
        ...

    async def record_event(self, event: LearningEvent) -> None:
        ...

    async def sync_turn(self, turn: LearningTurn) -> None:
        ...

    async def on_session_end(self, *, session_id: str, user_id: str | None) -> None:
        ...

    async def shutdown(self) -> None:
        ...
```

## Null provider

The generic module should default to no persistence.

```python
class NullLearningProvider:
    async def is_available(self) -> bool:
        return False

    async def initialize(self, *, session_id: str, user_id: str | None, surface: str) -> None:
        return None

    async def startup_context(self, *, session_id: str, user_id: str | None) -> list[LearningContextBlock]:
        return []

    async def prefetch(self, *, query: str, session_id: str, user_id: str | None, signal_id: str | None = None) -> list[LearningContextBlock]:
        return []

    async def record_event(self, event: LearningEvent) -> None:
        return None

    async def sync_turn(self, turn: LearningTurn) -> None:
        return None

    async def on_session_end(self, *, session_id: str, user_id: str | None) -> None:
        return None

    async def shutdown(self) -> None:
        return None
```

Add module-level functions similar to `data_store.py`:

```python
_default_learning_provider: LearningProvider = NullLearningProvider()


def set_default_learning_provider(provider: LearningProvider) -> None:
    global _default_learning_provider
    _default_learning_provider = provider


def get_default_learning_provider() -> LearningProvider:
    return _default_learning_provider
```

## Context fencing

Learning context must be injected as background context, not as a stored user message.

```python
def format_learning_context(blocks: list[LearningContextBlock]) -> str:
    usable = [block for block in blocks if block.text.strip()]
    if not usable:
        return ""
    lines = [
        "<learning-context>",
        "[System note: The following is recalled learning context, not new user input. Use it only as background. Do not quote it unless asked.]",
        "",
    ]
    for block in usable:
        scope = block.scope
        if block.signal_id:
            scope = f"{scope}:{block.signal_id}"
        lines.append(f"Scope: {scope}")
        lines.append(f"Source: {block.source}")
        lines.append(f"Retrieved at: {block.retrieved_at}")
        if block.max_age_seconds is not None:
            lines.append(f"Max age seconds: {block.max_age_seconds}")
        lines.append(block.text.strip())
        lines.append("")
    lines.append("</learning-context>")
    return "\n".join(lines)
```

In this generic module, the simplest safe path is to append startup context to `extra_context` during session creation only when the application explicitly configured a provider. Later, a deeper integration can inject pre-turn context from frontend events or an app-owned orchestration layer.

## Session creation hook

In `main.py:create_realtime_session()`:

1. Generate `session_id`.
2. Initialize learning provider.
3. Fetch startup context.
4. Format context.
5. Append it to `payload.extra_context` before building Realtime session config.
6. Record `voice.session.created`.

Important: do not mutate the stored original request object without making it clear. Build a copy/derived request for session config.

Pseudo-flow:

```python
provider = get_default_learning_provider()
await provider.initialize(session_id=session_id, user_id=payload.user_id, surface="browser")
startup_blocks = await provider.startup_context(session_id=session_id, user_id=payload.user_id)
learning_context = format_learning_context(startup_blocks)

session_payload = payload
if learning_context:
    session_payload = payload.model_copy(
        update={
            "extra_context": "\n\n".join(
                part for part in [payload.extra_context, learning_context] if part
            )
        }
    )

session_config = build_realtime_session_config(session_payload, current)
```

Then record the event:

```python
await provider.record_event(
    LearningEvent(
        event_id=str(uuid4()),
        event_type="voice.session.created",
        session_id=session_id,
        user_id=payload.user_id,
        occurred_at=datetime.now(UTC).isoformat(),
        payload={
            "connectionMode": payload.connection_mode,
            "model": model,
            "voice": voice,
            "toolsEnabled": payload.enable_tools,
        },
    )
)
```

## Tool execution hook

In `main.py:execute_tool()` or inside `tools.py:execute_tool_call()`:

- record tool call start;
- execute the live tool;
- record success/failure with timestamps;
- never write the full private tool result into durable learning by default.

Recommended payload for success:

```python
{
  "toolName": payload.tool_name,
  "status": "completed",
  "resultKind": "json",
  "resultSize": len(output),
  "lookedUpAt": parsed_output.get("lookedUpAt"),
}
```

For private data tools, persist only metadata unless the app's provider policy explicitly allows private event storage.

## Frontend event hook

The frontend currently owns the WebRTC event loop. It sees Realtime events such as transcripts, response completion, and function calls. The generic module can expose optional callbacks in `realtimeClient.ts`:

```ts
export interface RealtimeLearningHooks {
  onUserTranscriptFinal?: (text: string, event: unknown) => void | Promise<void>;
  onAssistantTranscriptFinal?: (text: string, event: unknown) => void | Promise<void>;
  onRealtimeEvent?: (event: unknown) => void | Promise<void>;
  onTurnCompleted?: (turn: {
    userText?: string;
    assistantText?: string;
    toolCalls?: unknown[];
  }) => void | Promise<void>;
}
```

This keeps the generic browser page usable while letting ReSono Cloud/Vault products wire their own capture path.

## Deriver worker contract

The Voice Module does not need to include the worker yet, but providers should be designed for one.

Queue item shape:

```json
{
  "id": "queue-item-id",
  "workUnitKey": "learning:user:<user-id>:signal:<signal-id>",
  "sessionId": "voice-session-id",
  "eventIds": ["..."],
  "taskType": "derive_observations",
  "status": "queued",
  "createdAt": "2026-06-15T19:00:00-04:00"
}
```

Worker behavior:

- batch events from the same work unit;
- include adjacent context;
- produce observations with evidence ids;
- deduplicate;
- stage observations for review if policy requires it;
- expose queue status.

## Learning tools

Do not expose raw mutation tools. If tools are added, keep them small:

```json
[
  {
    "type": "function",
    "name": "learning_lookup",
    "description": "Look up approved durable learning relevant to this turn. This is not a live private-data lookup.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {"type": "string"},
        "scope": {"type": "string"},
        "signalId": {"type": "string"}
      },
      "required": ["query"],
      "additionalProperties": false
    }
  },
  {
    "type": "function",
    "name": "learning_propose",
    "description": "Stage a durable memory or signal-playbook proposal for review.",
    "parameters": {
      "type": "object",
      "properties": {
        "kind": {"type": "string"},
        "content": {"type": "string"},
        "scope": {"type": "string"},
        "signalId": {"type": "string"},
        "evidenceEventIds": {"type": "array", "items": {"type": "string"}}
      },
      "required": ["kind", "content", "scope"],
      "additionalProperties": false
    }
  }
]
```

The tool descriptions must explicitly say learning lookup is not a substitute for live data. That protects email/calendar/radar behavior.

## Signal freshness rule

Add this to any system message or signal playbook that has access to live private data:

```text
Learned memory may guide preferences and workflow, but it must not be used as the source of current email, calendar, radar, news, weather, or connection data. For current private data, call the live signal tool. If a live tool fails, report the failure and do not silently answer from memory.
```

## Minimal implementation checklist

1. Add `backend/app/learning.py` with protocol, dataclasses, null provider, setter/getter, and formatter.
2. In `main.py`, initialize provider and append startup learning context before `build_realtime_session_config()`.
3. In `main.py` or `tools.py`, record tool execution metadata.
4. In `frontend/src/realtimeClient.ts`, add optional learning callbacks for final transcript and turn events.
5. Keep learning disabled by default.
6. Add tests that prove:
   - no context is injected with `NullLearningProvider`;
   - learning context is fenced;
   - `query_data_store` still returns live lookup metadata;
   - tool result bodies are not automatically stored as learning events.

## Migration guidance for ReSono Cloud/Vault

Cloud/Vault applications should wire their provider at startup:

```python
from app.learning import set_default_learning_provider
from resono_vault_learning import VaultLearningProvider

set_default_learning_provider(
    VaultLearningProvider(
        account_id=account_id,
        user_id=user_id,
        encryption_context=encryption_context,
    )
)
```

The generic module should not decide whether data belongs to Cloud or Vault. It should accept the provider chosen by the host application.

## Non-goals

- Do not save sessions in the generic module by default.
- Do not ship a production Vault provider in the generic module.
- Do not answer live signal requests from learned memory.
- Do not let the browser write durable learning directly.
- Do not let learning tools mutate private data without backend policy checks.
