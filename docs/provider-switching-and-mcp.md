# Provider Switching and MCP

This module is OpenAI Realtime-first because the browser voice path uses OpenAI's WebRTC Realtime API. You can still design the module so providers are swappable.

There are two different layers:

- Voice transport provider: OpenAI Realtime, ElevenLabs, another realtime media provider
- Tool provider: MCP or function tools that expose app capabilities to the model

Do not mix those up. MCP can expose tools, but it does not automatically make Claude or ElevenLabs a drop-in replacement for OpenAI Realtime WebRTC.

## Simple Provider Interface

Create a provider interface around session setup:

```ts
type VoiceProviderSession = {
  sessionId: string;
  mode: "ephemeral" | "server_sdp" | "provider_specific";
  iceServers: RTCIceServer[];
  connect: (peerConnection: RTCPeerConnection, localOfferSdp: string) => Promise<string>;
};
```

For OpenAI:

- backend mints ephemeral token
- browser posts SDP to `/v1/realtime/calls`
- provider returns SDP answer

For another provider:

- implement that provider's session creation
- map its media transport to the same browser lifecycle if it supports WebRTC
- if it does not support WebRTC, write a separate transport adapter instead of forcing it into this module

## Claude

Claude is normally a text/tool reasoning provider, not a browser WebRTC voice transport provider.

Recommended use:

- Keep OpenAI Realtime or another voice provider for live audio.
- Use Claude as a delegated text/reasoning provider behind `delegate_task`.
- Return Claude's output as function-call output to the realtime voice model.

If Claude is the primary assistant, you still need:

- speech-to-text
- turn detection
- text model call
- text-to-speech
- interruption handling
- streaming audio output

That becomes a pipeline, not the same Realtime WebRTC contract.

## ElevenLabs

ElevenLabs is commonly used for speech generation and some realtime voice workflows, depending on the product/API selected.

Recommended use cases:

- Use ElevenLabs as a TTS/audio provider behind a provider adapter.
- Keep the same UI status and microphone handling only if the selected ElevenLabs flow supports browser WebRTC or equivalent low-latency streaming.
- If it uses WebSocket or HTTP streaming, implement a separate transport class and keep it outside the OpenAI Realtime client.

Do not claim feature parity until these are mapped:

- SDP or non-SDP setup
- microphone uplink
- interruption handling
- VAD ownership
- transcript events
- tool call events
- usage reporting
- auth token lifetime

## Simple MCP Server for Tools

Use MCP when you want provider-neutral tools. A simple MCP-style server can expose app capabilities such as:

- `query_data_store`
- `send_email_draft`
- `calendar_lookup`
- `weather_lookup`
- `daily_brief_read`

For OpenAI Realtime, you can either:

- register MCP tools directly in the Realtime session when appropriate, or
- keep function tools in Realtime and have your backend call MCP servers internally.

The second option is often better for privacy and provider switching because the voice model only sees a stable function tool contract.

## Minimal MCP Tool Bridge

```text
Realtime model
  -> function call: query_data_store
Browser data channel
  -> POST /api/tools/execute
Backend
  -> MCP server tool call
MCP server
  -> data source lookup
Backend
  -> function_call_output JSON string
Browser
  -> conversation.item.create function_call_output
Realtime model
  -> spoken answer
```

## Example MCP Server Shape

```ts
const tools = {
  query_data_store: {
    description: "Search the selected cloud or vault data store.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        namespace: { type: "string" }
      },
      required: ["query"]
    },
    async call(args, context) {
      return context.dataStore.search(args);
    }
  }
};
```

Keep MCP server auth separate from voice provider auth. A user should be able to switch voice providers without changing data-source permissions.

## Recommended Architecture

```text
Browser UI
  -> VoiceTransportAdapter
      -> OpenAIRealtimeWebRTCAdapter
      -> ElevenLabsAdapter
      -> CustomProviderAdapter
  -> ToolBridge
      -> Backend function tool endpoint
          -> MCP client
              -> MCP servers
  -> Transcript/Status/Usage UI
```

Provider switching should happen at adapter boundaries:

- session creation
- SDP or stream setup
- event parsing
- tool-call event format
- transcript event format
- usage event format

The UI should stay stable.
