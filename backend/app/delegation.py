from __future__ import annotations

from typing import Any

import httpx

from app.settings import Settings


def _headers(settings: Settings) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
    if settings.openai_organization:
        headers["OpenAI-Organization"] = settings.openai_organization
    return headers


def _extract_output_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    output = payload.get("output")
    if not isinstance(output, list):
        return ""
    parts: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
    return "\n".join(parts).strip()


async def delegate_to_text_model(
    *,
    settings: Settings,
    task: str,
    context: str | None = None,
    response_style: str | None = None,
    prompt_cache_key: str | None = None,
) -> dict[str, Any]:
    if settings.provider_mode != "live" or not settings.openai_api_key:
        return {
            "status": "mock",
            "summary": "Text-model delegation is in mock mode because OPENAI_API_KEY is not configured.",
        }

    instructions = (
        "You are a text supervisor for a realtime voice assistant. "
        "Think through the task and return concise guidance that the realtime voice model can rephrase."
    )
    input_text = f"Task:\n{task.strip()}"
    if context and context.strip():
        input_text += f"\n\nContext:\n{context.strip()}"
    if response_style and response_style.strip():
        input_text += f"\n\nPreferred response style:\n{response_style.strip()}"
    payload: dict[str, Any] = {
        "model": settings.text_model,
        "instructions": instructions,
        "input": input_text,
        "store": False,
        "max_output_tokens": 800,
        "prompt_cache_key": prompt_cache_key or "resono-voice-module-supervisor-v1",
        "prompt_cache_retention": "24h",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.openai_base_url}/responses",
            headers=_headers(settings),
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
    return {
        "status": "completed",
        "model": settings.text_model,
        "output": _extract_output_text(data),
        "responseId": data.get("id"),
        "usage": data.get("usage"),
    }
