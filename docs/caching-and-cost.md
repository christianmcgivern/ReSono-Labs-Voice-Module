# Caching and Cost

OpenAI Realtime costs accumulate per response. Later turns can cost more because the conversation history grows.

## Prompt Caching

Prompt caching works best when the prefix is stable.

Keep these stable near the beginning of the session:

- system prompt
- tool names
- tool schemas
- static policy text

Put dynamic context later:

- current user request
- latest lookup results
- short session context

Avoid changing tool definitions during a session.

## Module Defaults

The module uses:

```json
{
  "truncation": {
    "type": "retention_ratio",
    "retention_ratio": 0.8,
    "token_limits": { "post_instructions": 8000 }
  }
}
```

The frontend reads usage from `response.done.response.usage`:

- `input_tokens`
- `input_tokens_details.cached_tokens`
- `output_tokens`
- `total_tokens`

## Cost Controls

- Use VAD so silence does not create unnecessary responses.
- Keep startup greeting optional.
- Use short spoken preambles before tools.
- Summarize long context into compact state.
- Delegate heavy work to a text model only when it reduces realtime context cost or latency.
- Do not preload private data that can be fetched by a narrow tool call.
