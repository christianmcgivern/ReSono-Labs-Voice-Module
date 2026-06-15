# Tool Use

Realtime tools should be function tools when the application owns private data, approval checks, or business logic.

## Contract

The session config includes tools:

```json
{
  "type": "function",
  "name": "query_data_store",
  "description": "Run a fresh lookup against the application's selected data store.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "namespace": { "type": "string" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
    },
    "required": ["query"],
    "additionalProperties": false
  }
}
```

The model emits `response.function_call_arguments.done`.

The browser:

1. Reads `call_id`, `name`, and `arguments`.
2. Posts the call to `/api/tools/execute`.
3. Sends the output back over `oai-events`:

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_id",
    "output": "{\"status\":\"completed\"}"
  }
}
```

4. Sends `response.create` after a short delay if no response is already in flight.

## Included Tools

- `wait_for_user`
- `query_data_store`
- `delegate_task`

These are examples. Production apps should register their actual signal/connection tools in `backend/app/tools.py`.

## Rules

- Never return stale data for private/current data requests unless the tool explicitly reports that it is cached.
- Include lookup timestamps in tool outputs.
- Keep side-effect tools behind explicit confirmation.
- Return valid JSON strings for success and failure.
- Keep tool names stable; changing tool schemas mid-session can hurt prompt caching.
