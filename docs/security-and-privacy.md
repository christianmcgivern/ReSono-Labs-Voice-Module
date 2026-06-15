# Security and Privacy

## Keys

The standard OpenAI API key must stay on the backend.

Allowed browser exposure:

- ephemeral Realtime client secret
- SDP answer
- non-sensitive session metadata
- ICE server configuration

Never expose:

- standard provider API key
- vault route secrets
- private data store credentials
- raw private tool payloads beyond what the active user is allowed to see

## Browser Sessions

The browser handles:

- microphone capture
- WebRTC peer connection
- data channel events
- transcript display
- function call output return

The browser should not enforce final data policy. It can assist UX, but the backend or vault must enforce permissions.

## Cloud and Vault Boundary

For cloud-backed users, cloud tools can execute in the platform backend.

For vault-backed users, private-data tools should execute on the vault side or through a vault-approved route. The cloud may keep settings, auth, and non-private control metadata, but it should not receive raw private results unless policy allows it.

## Logs

Avoid logging:

- SDP bodies
- user audio
- raw transcripts in production
- tool arguments containing private data
- tool outputs containing private data
- ephemeral client secrets

## Ephemeral Tokens

Ephemeral Realtime tokens are recommended for browser WebRTC sessions.

The server should mint a fresh token per voice session, return it to the browser, and discard it. The browser uses it only to authenticate the SDP exchange with the Realtime endpoint. Do not reuse the token for later sessions, do not persist it in local storage, and do not log it.

Set `OpenAI-Safety-Identifier` when the server creates the ephemeral client secret. Use a hashed user id or session id, not raw personally identifying data.

Useful safe logs:

- session id
- provider mode
- transport mode
- model
- connection state
- ICE state
- tool name
- success/error code
- usage counts

## ICE

STUN server URLs are not private credentials. TURN credentials can be sensitive and should come from backend config or short-lived credential issuance.

## Tool Safety

- Read-only lookup tools can run after user intent is clear.
- External side effects require confirmation.
- Tool output must be scoped to the active user/session.
- Include freshness metadata for live-data tools.
- Return explicit stale/error states instead of silently answering from old cache.
