from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from app.data_store import get_default_data_store, live_lookup_metadata
from app.delegation import delegate_to_text_model
from app.schemas import ToolExecutionRequest
from app.settings import Settings


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "wait_for_user",
        "description": "Use when the user is silent, background speech is not addressed to the assistant, or no answer is needed yet.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "Short reason for waiting."},
            },
            "required": ["reason"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "query_data_store",
        "description": "Run a fresh lookup against the application's selected data store.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "namespace": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 10},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "delegate_task",
        "description": "Delegate deeper reasoning or long-form synthesis to a text model, then return guidance to the realtime voice model.",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {"type": "string"},
                "context": {"type": "string"},
                "responseStyle": {"type": "string"},
            },
            "required": ["task"],
            "additionalProperties": False,
        },
    },
]


def tool_definitions_for_names(names: list[str] | None) -> list[dict[str, Any]]:
    if names is None:
        return TOOL_DEFINITIONS.copy()
    allowed = set(names)
    return [tool for tool in TOOL_DEFINITIONS if tool["name"] in allowed]


def _loads_arguments(arguments_json: str) -> dict[str, Any]:
    try:
        parsed = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


async def execute_tool_call(request: ToolExecutionRequest, settings: Settings) -> str:
    arguments = _loads_arguments(request.arguments_json)
    if request.tool_name == "wait_for_user":
        return json.dumps(
            {
                "status": "waiting",
                "reason": str(arguments.get("reason") or "No user-directed request detected."),
                "waitedAt": datetime.now(UTC).isoformat(),
            }
        )
    if request.tool_name == "query_data_store":
        query = str(arguments.get("query") or "").strip()
        namespace = arguments.get("namespace")
        namespace_value = namespace.strip() if isinstance(namespace, str) and namespace.strip() else None
        limit_raw = arguments.get("limit")
        limit = limit_raw if isinstance(limit_raw, int) else 5
        documents = await get_default_data_store().search(query=query, namespace=namespace_value, limit=limit)
        return json.dumps(
            {
                "status": "completed",
                **live_lookup_metadata(),
                "documents": [
                    {
                        "namespace": doc.namespace,
                        "title": doc.title,
                        "body": doc.body,
                        "source": doc.source,
                    }
                    for doc in documents
                ],
            }
        )
    if request.tool_name == "delegate_task":
        result = await delegate_to_text_model(
            settings=settings,
            task=str(arguments.get("task") or ""),
            context=str(arguments.get("context") or "") or None,
            response_style=str(arguments.get("responseStyle") or "") or None,
        )
        return json.dumps(result)
    return json.dumps(
        {
            "status": "error",
            "code": "unknown_tool",
            "message": f"Tool {request.tool_name!r} is not registered in this module.",
        }
    )
