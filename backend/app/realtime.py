from __future__ import annotations

import hashlib
import json
from typing import Any

import httpx

from app.schemas import RealtimeSessionCreateRequest, TurnDetectionConfig
from app.settings import Settings
from app.system_prompt import build_system_message
from app.tools import tool_definitions_for_names


def safety_identifier(user_id: str | None) -> str:
    return hashlib.sha256((user_id or "anonymous").encode("utf-8")).hexdigest()


def realtime_headers(settings: Settings, *, user_id: str | None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "OpenAI-Safety-Identifier": safety_identifier(user_id),
    }
    if settings.openai_organization:
        headers["OpenAI-Organization"] = settings.openai_organization
    return headers


def build_turn_detection(config: TurnDetectionConfig) -> dict[str, Any] | None:
    if config.mode == "off":
        return None
    payload: dict[str, Any] = {
        "type": config.mode,
        "create_response": config.create_response,
        "interrupt_response": config.interrupt_response,
    }
    if config.mode == "semantic_vad":
        if config.eagerness:
            payload["eagerness"] = config.eagerness
        return payload
    payload.update(
        {
            "threshold": config.threshold,
            "prefix_padding_ms": config.prefix_padding_ms,
            "silence_duration_ms": config.silence_duration_ms,
        }
    )
    return payload


def build_realtime_session_config(request: RealtimeSessionCreateRequest, settings: Settings) -> dict[str, Any]:
    model = request.model or settings.realtime_model
    voice = request.voice or settings.realtime_voice
    input_audio: dict[str, Any] = {
        "format": {"type": "audio/pcm", "rate": 24000},
        "noise_reduction": {"type": "near_field"},
        "transcription": {"model": settings.realtime_transcription_model},
    }
    turn_detection = build_turn_detection(request.turn_detection)
    if turn_detection is None:
        input_audio["turn_detection"] = None
    else:
        input_audio["turn_detection"] = turn_detection

    session: dict[str, Any] = {
        "type": "realtime",
        "model": model,
        "instructions": build_system_message(request.system_message, request.extra_context),
        "output_modalities": request.output_modalities,
        "audio": {
            "input": input_audio,
            "output": {
                "format": {"type": "audio/pcm", "rate": 24000},
                "voice": voice,
            },
        },
        "reasoning": {"effort": request.reasoning_effort},
    }
    if request.enable_tools:
        tools = tool_definitions_for_names(request.tool_names)
        if tools:
            session["tools"] = tools
            session["tool_choice"] = "auto"
    if request.truncation_retention_ratio is not None or request.token_limit_post_instructions is not None:
        truncation: dict[str, Any] = {"type": "retention_ratio"}
        if request.truncation_retention_ratio is not None:
            truncation["retention_ratio"] = request.truncation_retention_ratio
        if request.token_limit_post_instructions is not None:
            truncation["token_limits"] = {"post_instructions": request.token_limit_post_instructions}
        session["truncation"] = truncation
    return session


async def create_client_secret(
    *,
    settings: Settings,
    session_config: dict[str, Any],
    user_id: str | None,
) -> dict[str, Any]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required for live Realtime sessions.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.openai_base_url}/realtime/client_secrets",
            headers={
                **realtime_headers(settings, user_id=user_id),
                "Content-Type": "application/json",
            },
            json={"session": session_config},
        )
        response.raise_for_status()
        data = response.json()
    client_secret = data.get("value")
    if not isinstance(client_secret, str) or not client_secret:
        nested = data.get("client_secret")
        if isinstance(nested, dict):
            client_secret = nested.get("value")
    if not isinstance(client_secret, str) or not client_secret:
        raise RuntimeError("Realtime client secret response did not contain a usable token.")
    return {
        "clientSecret": client_secret,
        "expiresAt": data.get("expires_at") if isinstance(data.get("expires_at"), int) else None,
        "raw": data,
    }


async def create_webrtc_call(
    *,
    settings: Settings,
    session_config: dict[str, Any],
    sdp_offer: str,
    user_id: str | None,
) -> str:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required for live Realtime sessions.")
    files = {
        "sdp": (None, sdp_offer),
        "session": (None, json.dumps(session_config), "application/json"),
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.openai_base_url}/realtime/calls",
            headers=realtime_headers(settings, user_id=user_id),
            files=files,
        )
        response.raise_for_status()
        return response.text


def build_auto_greeting_event() -> dict[str, Any]:
    return {
        "type": "conversation.item.create",
        "item": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "Start this live voice session. Greet the user briefly, say you are ready, "
                        "and mention that they can interrupt by speaking."
                    ),
                }
            ],
        },
    }
