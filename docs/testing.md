# Testing

## Static Checks

Backend:

```bash
python -m py_compile backend/app/*.py
```

Frontend:

```bash
cd frontend
npm install
npm run build
```

## Live Browser Check

1. Set `OPENAI_API_KEY`.
2. Set `VOICE_MODULE_PROVIDER_MODE=live`.
3. Start backend and frontend.
4. Open the frontend.
5. Start a session in `ephemeral` mode.
6. Confirm:
   - microphone permission appears
   - peer connection reaches `connected`
   - ICE reaches `connected` or `completed`
   - data channel reaches `open`
   - transcript appears
   - `query_data_store` works when asked for stored module data
7. Repeat in `server_sdp` mode.

## STUN/TURN Check

Use default STUN first. Then test with production ICE JSON:

```json
[
  {"urls":["stun:stun.example.com:3478"]},
  {"urls":["turn:turn.example.com:3478"],"username":"user","credential":"secret"}
]
```

If direct connections fail on mobile/corporate networks, add TURN.
