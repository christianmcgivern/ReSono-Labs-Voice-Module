from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class TurnDetectionConfig(CamelModel):
    mode: Literal["server_vad", "semantic_vad", "off"] = "server_vad"
    threshold: float = Field(default=0.82, ge=0.0, le=1.0)
    prefix_padding_ms: int = Field(default=300, ge=0, le=2000)
    silence_duration_ms: int = Field(default=800, ge=100, le=3000)
    eagerness: Literal["low", "medium", "high", "auto"] | None = None
    create_response: bool = True
    interrupt_response: bool = True


class RealtimeSessionCreateRequest(CamelModel):
    connection_mode: Literal["ephemeral", "server_sdp"] = "ephemeral"
    user_id: str | None = None
    model: str | None = None
    voice: str | None = None
    system_message: str | None = None
    extra_context: str | None = None
    output_modalities: list[Literal["audio", "text"]] = Field(default_factory=lambda: ["audio"])
    reasoning_effort: Literal["low", "medium", "high"] = "low"
    turn_detection: TurnDetectionConfig = Field(default_factory=TurnDetectionConfig)
    enable_tools: bool = True
    tool_names: list[str] | None = None
    prompt_cache_key: str | None = None
    auto_greeting: bool = True
    truncation_retention_ratio: float | None = Field(default=0.8, ge=0.0, le=1.0)
    token_limit_post_instructions: int | None = Field(default=8000, ge=1024, le=20000)
    ice_servers_override: list[dict[str, Any]] | None = None


class RealtimeSessionCreateResponse(CamelModel):
    session_id: str
    provider_mode: str
    connection_mode: str
    model: str
    voice: str
    client_secret: str | None = None
    expires_at: int | None = None
    realtime_call_url: str
    server_offer_path: str | None = None
    ice_servers: list[dict[str, Any]]
    session_config: dict[str, Any]
    auto_greeting_event: dict[str, Any] | None = None


class WebrtcOfferRequest(CamelModel):
    sdp_offer: str


class WebrtcOfferResponse(CamelModel):
    session_id: str
    sdp_answer: str


class ToolExecutionRequest(CamelModel):
    call_id: str | None = None
    tool_name: str
    arguments_json: str = "{}"


class ToolExecutionResponse(CamelModel):
    call_id: str | None = None
    tool_name: str
    output: str


class HealthResponse(CamelModel):
    status: str
    provider_mode: str
    realtime_model: str
    ice_servers: list[dict[str, Any]]
