# Ephemeral Tokens

Ephemeral tokens are the recommended default for browser WebRTC sessions with OpenAI Realtime.

OpenAI's WebRTC docs describe this flow:

1. Browser requests a token from your server.
2. Server uses the standard OpenAI API key to create a Realtime client secret.
3. Server returns only the ephemeral token to the browser.
4. Browser uses the ephemeral token to authenticate the WebRTC SDP exchange with `/v1/realtime/calls`.

The standard API key stays on the server.

## Why Recommended

Use ephemeral tokens for browser/mobile voice because:

- the browser never sees the standard provider API key
- the backend can bind session config before media starts
- the backend can attach a privacy-preserving safety identifier
- the browser can connect directly to the Realtime WebRTC endpoint
- the session is scoped to one live Realtime setup instead of broad API access

Use server-mediated SDP only when the backend must proxy or enforce additional policy at call creation time.

## Backend Handling

The backend should:

- Authenticate the app user before minting a token.
- Build the complete session config server-side.
- Set `OpenAI-Safety-Identifier` when creating the client secret.
- Hash the user id or email before using it as the safety identifier.
- Return only:
  - ephemeral client secret
  - expiry
  - Realtime call URL
  - safe session metadata
  - ICE server config
- Never log the ephemeral secret.
- Never store the secret longer than needed.

This module does that in `backend/app/realtime.py`:

```py
response = await client.post(
    f"{settings.openai_base_url}/realtime/client_secrets",
    headers={
        "Authorization": f"Bearer {settings.openai_api_key}",
        "OpenAI-Safety-Identifier": safety_identifier(user_id),
        "Content-Type": "application/json",
    },
    json={"session": session_config},
)
```

## Browser Handling

The browser should:

- request a new ephemeral token for each new voice session
- create `RTCPeerConnection({ iceServers })`
- get microphone audio with `getUserMedia`
- create the `oai-events` data channel
- create and set a local SDP offer
- wait briefly for ICE gathering
- post the SDP offer to `/v1/realtime/calls` with the ephemeral token
- set the returned SDP answer
- discard the token when the session closes

This module does that in `frontend/src/realtimeClient.ts`.

## Expiry and Retry

Do not try to reuse ephemeral tokens across sessions.

If session setup fails because the token is expired or rejected:

1. close the peer connection
2. stop microphone tracks
3. request a new backend session
4. mint a new ephemeral token
5. create a fresh WebRTC offer

Do not refresh an active token in place. The token is for setting up the session; once WebRTC is established, the media/data channel is the active session path.

## Safety Identifier

OpenAI recommends passing a stable privacy-preserving user identifier for Realtime sessions with the `OpenAI-Safety-Identifier` header.

When creating an ephemeral client secret, set that header on the server-side request. The browser does not need to send it later when it connects with the ephemeral token.

Use:

```py
hashlib.sha256(user_id.encode("utf-8")).hexdigest()
```

Do not send raw email addresses or names as safety identifiers.
