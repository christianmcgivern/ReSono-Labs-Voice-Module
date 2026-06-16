# ReSono Voice Module

Generic realtime voice module extracted from the ReSono Voice and ReSono Emergency WebRTC implementations.

This module is intentionally standalone. It does not save session data, require a platform account, or assume a specific cloud/vault data store. It gives you the reusable parts:

- Browser WebRTC voice session setup
- Backend-owned OpenAI API key handling
- Recommended ephemeral-token WebRTC path and optional server-mediated SDP path
- Configurable STUN/TURN ICE servers
- Server VAD and semantic VAD controls
- Realtime transcript and usage handling
- Function tool bridge with backend execution
- Hooks for data store lookup and text-model delegation
- Prompt, tool, caching, and privacy docs

## Layout

```text
backend/
  app/
    main.py          FastAPI routes
    realtime.py      Realtime session object, client secret, SDP calls
    tools.py         Function tool definitions and execution
    data_store.py    Replaceable data-store adapter
    delegation.py    Text-model supervisor calls
frontend/
  src/
    App.tsx          Generic test/integration page
    realtimeClient.ts WebRTC + Realtime event loop
docs/                Implementation guides
scripts/             Dev startup helpers
```

## Start

```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
bash scripts/dev-backend.sh
```

In another shell:

```bash
cd frontend
npm install
npm run dev
```

The backend runs on `http://localhost:8787`. The frontend runs on `http://localhost:5173`.

Set `OPENAI_API_KEY` and `VOICE_MODULE_PROVIDER_MODE=live` for real sessions. Without a key, the UI loads in mock mode and does not open a media connection.

## WebRTC

Browser voice should use WebRTC. The backend creates a Realtime session config and either:

- returns an ephemeral client secret so the browser posts SDP to OpenAI directly, or
- accepts the browser SDP offer and posts the SDP plus session config from the backend.

Both modes keep the standard API key server-side.

Ephemeral tokens are the recommended default for browser voice. The browser should never receive the standard OpenAI API key.

## ICE / STUN / TURN

The module defaults to:

```json
[{"urls":["stun:stun.l.google.com:19302"]}]
```

Set `VOICE_MODULE_ICE_SERVERS_JSON` to override it. Use TURN when users are behind restrictive carrier NAT, VPN, or enterprise firewall networks.

## Reference Docs

- `docs/research-comparison.md`
- `docs/realtime-session-config.md`
- `docs/tool-use.md`
- `docs/data-store-integration.md`
- `docs/learning-provider-contract-2026-06-15.md`
- `docs/learning-system-research-2026-06-15.md`
- `docs/memory-system-design-2026-06-15.md`
- `docs/procedural-learning-system-2026-06-15.md`
- `docs/model-delegation.md`
- `docs/caching-and-cost.md`
- `docs/system-message.md`
- `docs/security-and-privacy.md`

## License

Free for personal and noncommercial use under the PolyForm Noncommercial
License 1.0.0. Commercial use requires a separate paid commercial license from
Christian McGivern and/or ReSono Labs. See `LICENSE`.
