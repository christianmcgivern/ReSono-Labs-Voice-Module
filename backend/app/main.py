from __future__ import annotations

import json
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.realtime import build_auto_greeting_event, build_realtime_session_config, create_client_secret, create_webrtc_call
from app.schemas import (
    HealthResponse,
    RealtimeSessionCreateRequest,
    RealtimeSessionCreateResponse,
    ToolExecutionRequest,
    ToolExecutionResponse,
    WebrtcOfferRequest,
    WebrtcOfferResponse,
)
from app.settings import get_settings
from app.tools import execute_tool_call


app = FastAPI(title="ReSono Voice Module", version="0.1.0")
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_sessions: dict[str, dict] = {}


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    current = get_settings()
    return HealthResponse(
        status="ok",
        provider_mode=current.provider_mode,
        realtime_model=current.realtime_model,
        ice_servers=current.ice_servers,
    )


@app.get("/api/realtime/config")
async def realtime_config() -> dict:
    current = get_settings()
    return {
        "providerMode": current.provider_mode,
        "realtimeModel": current.realtime_model,
        "realtimeVoice": current.realtime_voice,
        "transcriptionModel": current.realtime_transcription_model,
        "iceServers": current.ice_servers,
    }


@app.post("/api/realtime/sessions", response_model=RealtimeSessionCreateResponse, status_code=201)
async def create_realtime_session(payload: RealtimeSessionCreateRequest) -> RealtimeSessionCreateResponse:
    current = get_settings()
    session_id = str(uuid4())
    session_config = build_realtime_session_config(payload, current)
    model = str(session_config["model"])
    voice = str(session_config.get("audio", {}).get("output", {}).get("voice") or current.realtime_voice)
    client_secret: str | None = None
    expires_at: int | None = None

    if current.provider_mode == "live":
        try:
            if payload.connection_mode == "ephemeral":
                secret = await create_client_secret(
                    settings=current,
                    session_config=session_config,
                    user_id=payload.user_id,
                )
                client_secret = secret["clientSecret"]
                expires_at = secret["expiresAt"]
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Realtime session creation failed: {exc}") from exc

    ice_servers = payload.ice_servers_override or current.ice_servers
    _sessions[session_id] = {
        "request": payload.model_dump(mode="json", by_alias=True),
        "sessionConfig": session_config,
        "userId": payload.user_id,
        "iceServers": ice_servers,
    }
    return RealtimeSessionCreateResponse(
        session_id=session_id,
        provider_mode=current.provider_mode,
        connection_mode=payload.connection_mode,
        model=model,
        voice=voice,
        client_secret=client_secret,
        expires_at=expires_at,
        realtime_call_url=f"{current.openai_base_url}/realtime/calls",
        server_offer_path=f"/api/realtime/sessions/{session_id}/webrtc/offer"
        if payload.connection_mode == "server_sdp"
        else None,
        ice_servers=ice_servers,
        session_config=session_config,
        auto_greeting_event=build_auto_greeting_event() if payload.auto_greeting else None,
    )


@app.post("/api/realtime/sessions/{session_id}/webrtc/offer", response_model=WebrtcOfferResponse)
async def create_realtime_webrtc_offer(session_id: str, payload: WebrtcOfferRequest) -> WebrtcOfferResponse:
    current = get_settings()
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Realtime session was not found.")
    if current.provider_mode != "live":
        raise HTTPException(status_code=409, detail="Provider is not live. Set OPENAI_API_KEY and VOICE_MODULE_PROVIDER_MODE=live.")
    if not payload.sdp_offer.strip():
        raise HTTPException(status_code=400, detail="SDP offer is required.")
    try:
        answer = await create_webrtc_call(
            settings=current,
            session_config=session["sessionConfig"],
            sdp_offer=payload.sdp_offer,
            user_id=session.get("userId"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Realtime SDP exchange failed: {exc}") from exc
    return WebrtcOfferResponse(session_id=session_id, sdp_answer=answer)


@app.post("/api/tools/execute", response_model=ToolExecutionResponse)
async def execute_tool(payload: ToolExecutionRequest) -> ToolExecutionResponse:
    try:
        output = await execute_tool_call(payload, get_settings())
    except Exception as exc:
        output = json.dumps(
            {
                "status": "error",
                "code": "tool_execution_failed",
                "message": str(exc),
            }
        )
    return ToolExecutionResponse(call_id=payload.call_id, tool_name=payload.tool_name, output=output)
