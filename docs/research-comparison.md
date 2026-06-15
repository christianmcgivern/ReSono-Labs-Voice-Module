# Research Comparison

Date: 2026-06-15

## Sources Inspected

Current Voice project:

- `project-3d3354dadcad/workspace/app/providers/ai/openai_realtime.py`
- `project-3d3354dadcad/workspace/app/contracts/internal/openai_realtime_session.py`
- `project-3d3354dadcad/workspace/app/contracts/internal/realtime_session_guidance.py`
- `project-3d3354dadcad/workspace/app/modules/inference_runtime/realtime_session_builder.py`
- `project-3d3354dadcad/workspace/app/modules/voice_realtime/service.py`
- `project-3d3354dadcad/workspace/app/modules/voice_realtime/router.py`
- `project-3d3354dadcad/workspace/frontend/src/browser-voice/useBrowserVoiceSessionLifecycle.ts`
- `project-3d3354dadcad/workspace/frontend/src/browser-voice/useBrowserVoiceRealtimeEvents.ts`
- `project-3d3354dadcad/workspace/frontend/src/browser-voice/useBrowserVoiceToolBridge.ts`
- `project-3d3354dadcad/workspace/frontend/src/lib/realtime.ts`

Emergency project:

- `/home/christian/Documents/Projects/ReSono-Labs-Emergency/backend/app/providers/openai_realtime.py`
- `/home/christian/Documents/Projects/ReSono-Labs-Emergency/backend/app/main.py`
- `/home/christian/Documents/Projects/ReSono-Labs-Emergency/frontend/src/emergency/EmergencyApp.tsx`

OpenAI docs used:

- Realtime guide: `https://developers.openai.com/api/docs/guides/realtime`
- WebRTC guide: `https://developers.openai.com/api/docs/guides/realtime-webrtc`
- VAD guide: `https://developers.openai.com/api/docs/guides/realtime-vad`
- Tools/MCP guide: `https://developers.openai.com/api/docs/guides/realtime-mcp`
- Realtime costs: `https://developers.openai.com/api/docs/guides/realtime-costs`
- Realtime prompting: `https://developers.openai.com/api/docs/guides/realtime-models-prompting`
- Prompt caching: `https://developers.openai.com/api/docs/guides/prompt-caching`

WebRTC ICE reference:

- MDN `RTCPeerConnection()` constructor docs: `https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection`

## Voice Project Findings

The Voice project is the richer reference. It does not treat Realtime voice as only a media connection. It builds a full runtime plan before WebRTC starts.

Important backend behavior:

- `OpenAIRealtimeAdapter.create_realtime_client_secret` calls `/v1/realtime/client_secrets` with `{"session": session_object}`.
- `OpenAIRealtimeAdapter.create_realtime_call` calls `/v1/realtime/calls` with SDP plus the same session object.
- `build_openai_realtime_session_object` emits the GA session shape with:
  - `type: "realtime"`
  - `model`
  - `output_modalities`
  - `instructions`
  - `audio.input`
  - `audio.output`
  - `tools`
  - optional prompt and truncation config
- Function tools are converted to OpenAI Realtime function tool definitions.
- MCP and builtin tools are supported by the contract layer, but browser signal execution mostly follows function-tool output events.

Voice audio defaults:

- Voice: `marin`
- Input format: `audio/pcm` at `24000`
- Input noise reduction: `near_field`
- Output format: `audio/pcm` at `24000`
- Turn detection: `server_vad`
- Threshold: `0.82`
- Prefix padding: `300 ms`
- Silence duration: `800 ms`
- `create_response: true`
- `interrupt_response: true`

Important frontend behavior:

- Browser calls `/voice/realtime/sessions` with `connectionMode: "webrtc"`.
- Browser requests mic with echo cancellation, noise suppression, and auto gain control.
- Browser creates `RTCPeerConnection`.
- Browser creates data channel named `oai-events`.
- Browser waits for ICE gathering before posting SDP.
- Browser sends the SDP offer to the backend route `/voice/realtime/sessions/{id}/webrtc/offer`.
- Backend returns the SDP answer.
- Data channel event handling includes:
  - `input_audio_buffer.speech_started`
  - `input_audio_buffer.speech_stopped`
  - `conversation.item.input_audio_transcription.completed`
  - `response.output_audio_transcript.delta`
  - `response.output_audio_transcript.done`
  - `response.function_call_arguments.done`
  - `response.done`
  - `error`
- Function calls are executed by the app backend. The browser then sends:

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_id_from_event",
    "output": "json string"
  }
}
```

After that, the browser schedules `response.create`.

## Emergency Project Findings

Emergency is the smaller direct-path reference.

Important backend behavior:

- Backend creates an ephemeral client secret by posting to `/v1/realtime/client_secrets`.
- Backend includes `OpenAI-Safety-Identifier`.
- Backend returns:
  - ephemeral client secret
  - model
  - voice
  - call URL `/v1/realtime/calls`
- Emergency VAD defaults are stricter than Voice:
  - `server_vad`
  - threshold `0.97`
  - prefix padding `120 ms`
  - silence duration `850 ms`
  - `create_response: true`
  - `interrupt_response: true`

Important frontend behavior:

- Browser creates `RTCPeerConnection`.
- Browser requests mic with `{ audio: true }`.
- Browser creates `oai-events` data channel.
- Browser sends a startup user message when the data channel opens.
- Browser posts SDP directly to OpenAI `/v1/realtime/calls` using the ephemeral client secret.

Emergency has less status and transcript handling than Voice.

## Module Decisions

The module follows Voice for lifecycle and tools, and includes Emergency's direct ephemeral path.

Implemented choices:

- WebRTC only for browser audio.
- Two WebRTC session modes:
  - `ephemeral`: backend returns ephemeral token; browser posts SDP directly to OpenAI. This is the recommended default for browser voice.
  - `server_sdp`: backend posts SDP plus session config to OpenAI.
- Backend owns standard API key in both modes.
- Browser never receives the standard API key.
- Data channel name is `oai-events`.
- Function tools are executed by the application backend.
- Browser sends `function_call_output`, then schedules `response.create`.
- The frontend waits up to 1200 ms for ICE gathering before submitting SDP.
- STUN defaults to `stun:stun.l.google.com:19302`.
- TURN can be configured via `VOICE_MODULE_ICE_SERVERS_JSON`.

## What This Module Does Not Include

It does not include:

- Platform auth
- Vault route grants
- Vault opaque relay
- Account/workspace signal registry
- Session persistence
- Billing or usage metering persistence
- Cloud/vault trust workflow

Those should remain product-specific integrations around this reusable media/runtime module.
