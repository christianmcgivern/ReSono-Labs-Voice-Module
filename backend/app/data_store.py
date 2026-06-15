from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class DataStoreDocument:
    namespace: str
    title: str
    body: str
    source: str


class DataStoreAdapter(Protocol):
    async def search(self, *, query: str, namespace: str | None = None, limit: int = 5) -> list[DataStoreDocument]:
        """Return fresh documents for the current tool call."""


class InMemoryDataStore:
    def __init__(self) -> None:
        self._documents = [
            DataStoreDocument(
                namespace="overview",
                title="Module status",
                body="This sample data store is in-memory. Replace it with cloud, vault, or local private storage.",
                source="sample",
            ),
            DataStoreDocument(
                namespace="connections",
                title="Tool contract",
                body="Realtime function tools execute in the application backend and return function_call_output events.",
                source="sample",
            ),
        ]

    async def search(self, *, query: str, namespace: str | None = None, limit: int = 5) -> list[DataStoreDocument]:
        normalized = query.lower().strip()
        candidates = [
            doc
            for doc in self._documents
            if (namespace is None or doc.namespace == namespace)
            and (not normalized or normalized in f"{doc.title} {doc.body}".lower())
        ]
        return candidates[:limit]


_default_store: DataStoreAdapter = InMemoryDataStore()


def set_default_data_store(store: DataStoreAdapter) -> None:
    global _default_store
    _default_store = store


def get_default_data_store() -> DataStoreAdapter:
    return _default_store


def live_lookup_metadata() -> dict[str, str]:
    return {"lookedUpAt": datetime.now(UTC).isoformat()}
