from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")


DEFAULT_ICE_SERVERS = [{"urls": ["stun:stun.l.google.com:19302"]}]


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_ice_servers(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return DEFAULT_ICE_SERVERS.copy()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("VOICE_MODULE_ICE_SERVERS_JSON must be valid JSON.") from exc
    if not isinstance(parsed, list):
        raise RuntimeError("VOICE_MODULE_ICE_SERVERS_JSON must be a JSON array.")
    cleaned: list[dict[str, Any]] = []
    for entry in parsed:
        if not isinstance(entry, dict):
            raise RuntimeError("Each ICE server must be an object.")
        urls = entry.get("urls")
        if isinstance(urls, str):
            urls = [urls]
        if not isinstance(urls, list) or not all(isinstance(url, str) and url for url in urls):
            raise RuntimeError("Each ICE server requires a urls string or urls array.")
        item: dict[str, Any] = {"urls": urls}
        for optional_key in ("username", "credential", "credentialType"):
            value = entry.get(optional_key)
            if isinstance(value, str) and value:
                item[optional_key] = value
        cleaned.append(item)
    return cleaned


@dataclass(frozen=True, slots=True)
class Settings:
    openai_api_key: str | None
    openai_base_url: str
    openai_organization: str | None
    provider_mode: str
    realtime_model: str
    realtime_voice: str
    realtime_transcription_model: str
    text_model: str
    allowed_origins: list[str]
    ice_servers: list[dict[str, Any]]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    api_key = os.getenv("OPENAI_API_KEY")
    provider_mode = os.getenv("VOICE_MODULE_PROVIDER_MODE")
    if not provider_mode:
        provider_mode = "live" if api_key else "mock"
    return Settings(
        openai_api_key=api_key,
        openai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        openai_organization=os.getenv("OPENAI_ORGANIZATION"),
        provider_mode=provider_mode,
        realtime_model=os.getenv("VOICE_MODULE_REALTIME_MODEL", "gpt-realtime-2"),
        realtime_voice=os.getenv("VOICE_MODULE_REALTIME_VOICE", "marin"),
        realtime_transcription_model=os.getenv("VOICE_MODULE_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
        text_model=os.getenv("VOICE_MODULE_TEXT_MODEL", "gpt-5.5"),
        allowed_origins=_split_csv(
            os.getenv("VOICE_MODULE_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
        ),
        ice_servers=_parse_ice_servers(os.getenv("VOICE_MODULE_ICE_SERVERS_JSON")),
    )
