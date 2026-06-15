# Model Delegation

Realtime voice models should stay responsive. Delegate heavier text reasoning to a text model when needed.

## Pattern

1. Realtime model calls `delegate_task`.
2. Backend sends the task to a text model using the Responses API.
3. Backend returns concise guidance as function output.
4. Realtime model rephrases the guidance for voice.

`backend/app/delegation.py` implements this pattern.

## Use Cases

- Long summarization
- Multi-step reasoning
- Policy analysis
- Drafting text before reading a short spoken version
- Ranking or classification tasks

## Boundaries

The text model should not directly speak to the user. It is the supervisor. The realtime model remains the responder.

## Privacy

Only pass the minimum context needed for the delegated task. For vault-backed data, delegation must run in the vault path or receive only approved derived context.
