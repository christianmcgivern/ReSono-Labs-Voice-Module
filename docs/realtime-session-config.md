# Realtime Session Config

The backend builds the Realtime session object before browser WebRTC starts.

## Session Shape

```json
{
  "type": "realtime",
  "model": "gpt-realtime-2",
  "instructions": "system prompt",
  "output_modalities": ["audio"],
  "audio": {
    "input": {
      "format": { "type": "audio/pcm", "rate": 24000 },
      "noise_reduction": { "type": "near_field" },
      "transcription": { "model": "gpt-4o-mini-transcribe" },
      "turn_detection": {
        "type": "server_vad",
        "threshold": 0.82,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 800,
        "create_response": true,
        "interrupt_response": true
      }
    },
    "output": {
      "format": { "type": "audio/pcm", "rate": 24000 },
      "voice": "marin"
    }
  },
  "reasoning": { "effort": "low" },
  "tools": [],
  "tool_choice": "auto",
  "truncation": {
    "type": "retention_ratio",
    "retention_ratio": 0.8,
    "token_limits": { "post_instructions": 8000 }
  }
}
```

## Transport Modes

### Ephemeral

1. Browser asks backend for a Realtime session.
2. Backend posts `{"session": session_config}` to `/v1/realtime/client_secrets`.
3. Backend returns the ephemeral secret to the browser.
4. Browser creates a WebRTC offer.
5. Browser posts offer SDP directly to `/v1/realtime/calls` using the ephemeral secret.
6. Browser sets the returned SDP answer as the remote description.

Use this for browser/mobile modules by default. Ephemeral tokens are the recommended browser WebRTC setup because the standard API key stays on the server and the token is scoped to the Realtime session setup.

### Server SDP

1. Browser asks backend for a Realtime session.
2. Backend stores the session config.
3. Browser creates a WebRTC offer.
4. Browser posts offer SDP to the app backend.
5. Backend posts SDP plus session config to `/v1/realtime/calls`.
6. Backend returns the SDP answer to the browser.
7. Browser sets the answer as the remote description.

Use this when the backend needs to mediate the call creation, enforce policy, or hide provider-specific details.

## ICE Servers

The frontend calls:

```ts
new RTCPeerConnection({ iceServers });
```

Default:

```json
[{"urls":["stun:stun.l.google.com:19302"]}]
```

Set `VOICE_MODULE_ICE_SERVERS_JSON` for production. Use TURN when STUN alone is not enough:

```json
[
  {"urls":["stun:stun.example.com:3478"]},
  {
    "urls":["turn:turn.example.com:3478"],
    "username":"user",
    "credential":"secret"
  }
]
```

The frontend waits for ICE gathering before posting SDP. That matters because STUN/TURN candidates need time to appear in the local description.

## VAD

Default mirrors the Voice project:

- `server_vad`
- threshold `0.82`
- prefix padding `300 ms`
- silence duration `800 ms`
- `create_response: true`
- `interrupt_response: true`

Emergency used a stricter `0.97` threshold and shorter `120 ms` prefix padding. Keep that pattern for high-noise, high-stakes flows where false starts are worse than short response latency.

Use `semantic_vad` when sentence-level completeness matters more than silence duration. Use `off` only when the app will manually trigger responses.
