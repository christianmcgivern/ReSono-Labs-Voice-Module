# Data Store Integration

This module does not choose cloud or vault storage. It exposes a replaceable data-store adapter.

## Interface

`backend/app/data_store.py` defines:

```py
class DataStoreAdapter(Protocol):
    async def search(self, *, query: str, namespace: str | None = None, limit: int = 5) -> list[DataStoreDocument]:
        ...
```

Replace the default in-memory store:

```py
from app.data_store import set_default_data_store

set_default_data_store(MyCloudOrVaultStore())
```

## Cloud Store

For a cloud-backed user, the adapter should:

- Query the cloud database or service live.
- Enforce account/workspace authorization before returning data.
- Redact fields the voice session should not see.
- Include source and freshness metadata.

## Vault Store

For a vault-backed user, the adapter should:

- Run on or route to the vault side.
- Keep private data out of the platform process.
- Return only the tool output needed for the current response.
- Avoid writing transcripts or private payloads to cloud logs.
- Include freshness metadata generated on the vault side.

## Session Context

Static context belongs in `extraContext`. Current private data belongs behind tools. Do not preload large private data into the system message just to avoid tool calls.

## Freshness

Tool output should include:

- lookup timestamp
- data source
- cache policy, if any
- stale/error status when live lookup fails

The included `query_data_store` tool adds `lookedUpAt` to show this pattern.
