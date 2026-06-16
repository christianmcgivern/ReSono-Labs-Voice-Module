# Learning System Research Notes

Date: 2026-06-15

Scope: this document inspects two external open-source learning and memory systems, then maps the useful patterns into a generic ReSono Voice Module design. The goal is not to vendor either project into the module. The goal is to build the right learning hooks, storage contract, retrieval contract, and safety boundaries so a future data-store adapter can implement them cleanly.

Important module constraint: the current Voice Module should remain store-agnostic. It should expose learning hooks and a provider contract, not force session persistence.

## Sources inspected

Local source clones:

- `/tmp/resono_learning_research/honcho`
- `/tmp/resono_learning_research/hermes-agent`

Upstream references:

- Honcho GitHub: https://github.com/plastic-labs/honcho
- Honcho overview: https://honcho.dev/docs/v2/documentation/introduction/overview
- Honcho architecture: https://honcho.dev/docs/v2/documentation/core-concepts/architecture
- Hermes Agent GitHub: https://github.com/NousResearch/hermes-agent
- Hermes memory docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- Hermes memory providers docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers
- Hermes skills docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- Hermes cron docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron

## Executive finding

The inspected systems solve two different parts of learning.

The semantic-memory pattern is strongest for long-term user modeling. It stores raw interaction events, queues background derivation jobs, extracts compact observations, embeds and deduplicates them, and exposes them through context, search, queue status, and working representation APIs.

The agent-improvement pattern is strongest for bounded self-improvement. It separates compact declarative memory from procedural learning. Declarative facts live in small memory stores. Procedural knowledge lives in skills that can be created, patched, reviewed, gated, and reused. It also uses a provider abstraction that lets external memory systems run without coupling the agent loop to one backend.

For ReSono Voice Module, the right general design is a hybrid:

- raw voice/tool events go to the selected private data store when enabled;
- background derivation turns selected events into compact observations;
- runtime context injection uses only scoped, bounded, prompt-ready learning;
- procedural lessons become signal-specific playbooks or skills;
- live signal/tool data is never replaced by learned/cached memory.

## Semantic memory system: how learning works

Honcho centers the model around four primitives:

- Workspace: isolation boundary.
- Peer: a user, agent, service, or entity.
- Session: a conversation or interaction context.
- Message: the atomic event unit.

The key implementation path is not "save transcript and retrieve transcript." It is:

1. Store messages on a session.
2. Enqueue derivation work.
3. Process derivation work in the background.
4. Save compact observations with provenance.
5. Retrieve a selected representation or context bundle at runtime.

### Message ingestion and queueing

In `src/deriver/enqueue.py`, `enqueue()` receives message payloads and calls `handle_session()`. That resolves workspace/session configuration, peer configuration, and message-level configuration. It generates queue records for representation and summary tasks.

Representation queue records include:

- workspace name;
- session name;
- message id;
- observed peer;
- observer peer list;
- resolved reasoning configuration;
- task type `representation`;
- a work-unit key.

The work-unit key matters. Honcho processes items for the same representation serially, while unrelated work units can run in parallel. This is the right pattern for avoiding out-of-order learning updates for a single user/profile while still allowing throughput.

### Background deriver worker

In `src/deriver/queue_manager.py`, `QueueManager`:

- claims work units using `ActiveQueueSession`;
- avoids duplicate workers on the same work unit;
- cleans stale work units;
- batches representation tasks;
- enforces token caps;
- includes nearby conversational context;
- marks processed or errored queue items.

For representation tasks, `get_queue_item_batch()` finds the earliest unprocessed message for a work unit, optionally includes the preceding message from another peer for context, and includes messages forward until the token cap. It returns `QueueBatchResult` with messages, queue items, config, cap flags, and batching metadata.

This is a strong design for voice sessions because turn-level transcripts often need the user utterance, assistant response, and tool result together before the learning system can infer anything useful.

### Fact extraction

In `src/deriver/deriver.py`, `process_representation_tasks_batch()`:

- sorts messages by id;
- formats each message with timestamp and peer name;
- builds a minimal derivation prompt;
- calls the configured deriver LLM for structured output;
- converts output into `Representation`;
- saves observations for each observer.

The actual prompt in `src/deriver/prompts.py` asks the model to extract explicit atomic facts about the target peer. It requires observations to be self-contained and attributable to the exact peer id. It also normalizes relative time into absolute dates where possible.

This should translate directly into ReSono as a background "learning deriver" that creates compact facts from voice/tool events, not as live tool replacement.

### Observation model

In `src/utils/representation.py`, Honcho defines:

- `ExplicitObservation`: directly supported facts;
- `DeductiveObservation`: conclusions with premises;
- `InductiveObservation`: patterns with confidence;
- `ContradictionObservation`: conflicting facts;
- metadata including created time, message ids, session name, and document id.

The currently inspected minimal deriver only asks for explicit observations, but the representation model is broader. ReSono should model all four categories even if v1 only emits explicit/preferences/workflow observations.

### Persistence and retrieval

In `src/crud/representation.py`, `RepresentationManager.save_representation()`:

- normalizes observation text;
- batch-embeds observations;
- saves each observation as a document;
- includes metadata such as message ids, session name, premises, and message timestamp;
- deduplicates when configured;
- optionally schedules deeper background "dream" processing.

`get_working_representation()` blends:

- semantic observations for the query;
- most-derived observations when requested;
- recent observations;
- optional session scoping.

That blend is the key runtime behavior to copy conceptually. A voice agent should not load all memories. It should load the small, relevant subset for the current turn or current signal.

### Honcho runtime surfaces

Honcho exposes these useful surfaces:

- context: summaries plus recent messages, with optional peer representation;
- search: workspace/session/peer search over messages;
- working representation: cached observations relevant to a peer/session/query;
- dialectic chat: an LLM-mediated way to ask what the memory system knows;
- queue status: visibility into background derivation progress.

For ReSono, queue status is especially important. The UI and logs should be able to answer: "was this learning event accepted, queued, processed, errored, or skipped?"

## Agent memory and skills system: how learning works

Hermes has three learning layers:

- bounded declarative memory;
- session search;
- procedural skills.

It also has a memory provider contract that can connect external systems such as Honcho without changing the core agent loop.

### Bounded declarative memory

In `tools/memory_tool.py`, Hermes uses two memory files:

- `MEMORY.md`: agent notes, environment facts, conventions, tool quirks, lessons learned.
- `USER.md`: user profile, preferences, communication style, expectations.

Both live under the profile-scoped Hermes home. They are loaded at session start and rendered into the system prompt as a frozen snapshot. Mid-session writes persist to disk immediately, but they do not mutate the active system prompt until the next session.

This design intentionally protects prefix caching and keeps memory bounded. The docs describe default limits around 2,200 chars for memory and 1,375 chars for user profile.

The memory tool supports:

- `add`;
- `replace`;
- `remove`;
- read behavior through tool state responses.

It enforces:

- exact duplicate rejection;
- char limits;
- unique substring matching for replace/remove;
- prompt-injection/exfiltration scanning;
- file locking and atomic writes;
- drift detection when another writer changed the files.

This is useful for ReSono because user-approved durable memory needs hard limits and a clear review/delete surface. It should not be an unbounded transcript summary.

### Session search is separate from memory

Hermes `tools/session_search_tool.py` stores sessions in SQLite and uses FTS5 for actual-message recall. It is not LLM summarization. It returns matching messages, session bookends, and scroll windows.

This is a critical separation:

- memory is a compact always-on profile;
- session search is an on-demand archive lookup;
- neither is a live tool result.

For ReSono, email/calendar/radar/news results must remain live signal outputs. Learning can remember preferences and recurring patterns, but it must not answer "what emails do I have?" from memory.

### Memory provider contract

In `agent/memory_provider.py`, Hermes defines a clean external provider contract:

- `is_available()`;
- `initialize(session_id, **kwargs)`;
- `system_prompt_block()`;
- `prefetch(query, session_id=...)`;
- `queue_prefetch(query, session_id=...)`;
- `sync_turn(user_content, assistant_content, session_id=..., messages=...)`;
- `get_tool_schemas()`;
- `handle_tool_call(tool_name, args, **kwargs)`;
- `shutdown()`.

Optional hooks include:

- `on_turn_start()`;
- `on_session_end()`;
- `on_session_switch()`;
- `on_pre_compress()`;
- `on_memory_write()`;
- `on_delegation()`.

This is the cleanest model to copy for the Voice Module. The module should expose a `LearningProvider` interface with a null provider by default, and concrete providers can later target Vault, Cloud, local SQLite, Postgres, Honcho-like service, or another local store.

### Memory manager behavior

In `agent/memory_manager.py`, Hermes:

- allows built-in memory plus at most one external provider;
- injects provider tool schemas only when memory tools are enabled;
- prevents memory provider tools from shadowing reserved core tools;
- collects provider system-prompt blocks;
- prefetches context before turns;
- syncs completed turns in a background worker;
- fences memory context in `<memory-context>` blocks;
- scrubs streamed memory-context spans from user-visible output;
- notifies providers before compression discards context;
- notifies providers when sessions rotate.

The fencing/scrubbing behavior is worth copying. Memory context injected into a turn should not appear to the model as new user input, and it should not leak into the visible transcript.

### Background self-improvement review

In `agent/background_review.py`, Hermes can fork a background review agent after a turn. That review agent examines the conversation and decides whether to write memory or update skills.

Important safeguards:

- the review fork inherits the parent runtime, but uses `skip_memory=True` to avoid leaking the review harness prompt into external providers;
- it reuses the parent memory store for built-in memory writes;
- it disables compression in the review fork;
- it whitelists only memory and skill tools;
- it auto-denies dangerous commands;
- it surfaces a compact summary of successful memory/skill updates.

For ReSono, this pattern should be opt-in and gated. Background review is powerful, but wrong memories and wrong skill changes can degrade trust. User approval should be available for durable user memory and signal playbook changes.

### Skills as procedural memory

In `tools/skill_manager_tool.py`, Hermes treats skills as procedural memory. Skills capture "how to do a class of task," while memory captures declarative facts and preferences.

The skill manager can:

- create a skill;
- patch a skill;
- edit a skill;
- delete a skill;
- write supporting files;
- remove supporting files.

Hermes docs also describe a `skills.write_approval` gate. When enabled, skill writes are staged for review instead of immediately applied.

This maps well to ReSono signals:

- user preference: "summarize email tersely" -> user/signal preference memory;
- workflow lesson: "daily radar should check X then Y, and avoid stale cache" -> signal playbook/skill;
- implementation correction: "this provider needs a different auth flow" -> developer/system skill, not user memory.

### Automation and routines

Hermes cron support shows how learned skills can run inside automations:

- scheduled jobs;
- manual trigger;
- pause/resume/edit/remove;
- one or more attached skills;
- fresh agent sessions;
- delivery targets;
- no-agent script mode.

For ReSono, full automation should not be bolted onto voice only. Voice can create/configure/trigger automations, but the automation runtime needs its own provider-backed event store, signal contract, and audit trail.

## Recommended ReSono Voice Module design

### Core principle

Learning must augment the agent. It must not pretend to be live signal data.

The strongest rule:

> A learned memory may influence how a signal is run or how results are summarized, but it must not replace a live signal/tool call when the user asks for current private data.

Examples:

- Good memory: "User wants daily brief to prioritize calendar conflicts and urgent client emails."
- Bad memory: "User has 3 urgent emails today." That is stale unless it came from a live email signal run with a visible timestamp and source.
- Good playbook: "For email triage, search unread inbox, then starred/VIP, then summarize with sender and received time."
- Bad playbook: "Return last cached email summary when Gmail is slow."

### Provider interface

The module should define a store-agnostic learning provider. Suggested interface:

```ts
export interface LearningProvider {
  isAvailable(): Promise<boolean>;
  initialize(input: LearningInit): Promise<void>;
  getStartupContext(scope: LearningScope): Promise<LearningContextBlock[]>;
  prefetch(input: LearningPrefetchInput): Promise<LearningContextBlock[]>;
  recordEvent(event: LearningEvent): Promise<void>;
  syncTurn(turn: LearningTurn): Promise<void>;
  enqueueDerivation(input: DerivationEnqueueInput): Promise<void>;
  query(input: LearningQuery): Promise<LearningQueryResult>;
  proposeMemory(input: MemoryProposalInput): Promise<MemoryProposal>;
  approveProposal(id: string, decision: "approve" | "reject"): Promise<void>;
  onSessionEnd(session: LearningSessionEnd): Promise<void>;
  shutdown(): Promise<void>;
}
```

The default provider should be `NullLearningProvider`, which records nothing and returns no context. That keeps the generic module usable without a data store.

### Initialization input

`LearningInit` should include:

- user id or anonymized peer id;
- agent id;
- selected data-store mode;
- session id;
- platform/surface (`browser`, `ios`, `server`, etc.);
- privacy mode;
- whether passive learning is enabled;
- whether approval is required;
- available signal ids;
- current time and timezone;
- correlation id for logs.

### Event model

Use append-only events as the raw learning source. Suggested event types:

- `voice.user_transcript.final`;
- `voice.assistant_transcript.final`;
- `voice.turn.completed`;
- `tool.call.started`;
- `tool.call.completed`;
- `tool.call.failed`;
- `signal.run.started`;
- `signal.run.completed`;
- `signal.run.failed`;
- `user.feedback`;
- `user.correction`;
- `user.memory_request`;
- `automation.run.started`;
- `automation.run.completed`;
- `automation.run.failed`.

Each event should include:

- stable event id;
- session id;
- account/user peer id;
- agent peer id;
- signal id when relevant;
- event timestamp;
- source surface;
- content or structured payload;
- sensitivity classification;
- retention policy;
- parent event ids;
- trace id.

### Derived observation model

The deriver should create compact observations with evidence. Suggested shape:

```ts
export type ObservationKind =
  | "explicit_fact"
  | "preference"
  | "workflow_rule"
  | "tool_quirk"
  | "signal_preference"
  | "entity_fact"
  | "contradiction";

export interface LearningObservation {
  id: string;
  userId: string;
  agentId: string;
  kind: ObservationKind;
  scope: "global" | "surface" | "signal" | "automation" | "session";
  signalId?: string;
  content: string;
  confidence: "low" | "medium" | "high";
  evidenceEventIds: string[];
  createdAt: string;
  expiresAt?: string;
  sensitivity: "low" | "private" | "secret";
  status: "proposed" | "approved" | "active" | "rejected" | "revoked";
}
```

Initial implementation can emit only `explicit_fact`, `preference`, `signal_preference`, and `workflow_rule`. The schema should still leave room for contradictions and tool quirks.

### Derivation queue

Copy Honcho's queue shape conceptually:

- work unit key: account + observed peer + observer peer + session/signal scope;
- tasks for the same work unit run serially;
- independent work units run in parallel;
- batches include nearby context and tool results;
- token cap prevents runaway derivation;
- queue status is visible for debugging;
- failures mark individual items, not whole sessions.

Queue states:

- `accepted`;
- `queued`;
- `in_progress`;
- `processed`;
- `skipped`;
- `errored`;
- `revoked`.

The Voice Module should not need to ship the queue processor, but the contract should reserve these states because the future Vault/Cloud implementation will need them.

### Runtime context injection

Use three context lanes:

1. Startup context: small, approved, stable profile facts and signal preferences.
2. Pre-turn context: scoped retrieval for the current user message/signal.
3. Tool lookup: explicit `learning_lookup` style tool for deeper recall.

Startup context should be small and cache-friendly. Pre-turn context should be dynamic but fenced so it is not confused with user input.

Recommended injected block shape:

```text
<learning-context>
[System note: The following is recalled learning context, not new user input. Use it as background. Do not quote it unless asked.]

Scope: signal=email
Freshness: retrieved 2026-06-15T19:00:00-04:00

- User prefers email summaries grouped by urgency.
- User dislikes stale daily radar content; always show source timestamps.
</learning-context>
```

Never append learning context directly to a stored user message. It should exist only in the outbound model request.

### Skill/playbook layer for signals

ReSono should add a concept similar to Hermes procedural skills, but signal-oriented:

- `SignalPlaybook`: how to run or summarize a signal;
- `SignalPreference`: user-specific output and ranking preference;
- `SignalToolPolicy`: which tools are available and required freshness rules.

Suggested playbook fields:

- id;
- signal id;
- title;
- trigger description;
- procedure;
- expected tools;
- freshness requirements;
- failure handling;
- examples;
- approval status;
- version;
- created/updated metadata.

Voice learning should update playbooks only through approval or a controlled review queue. Do not silently rewrite how email/calendar/radar work after one interaction.

### Live signal/tool separation

The module should keep these boundaries explicit:

- `LearningProvider`: remembers durable preferences, facts, and workflow rules.
- `SignalRuntime`: executes live email/calendar/weather/news/radar tools.
- `SignalResultCache`: optional short-lived cost/performance cache with timestamps.
- `SessionContext`: current conversation only.

A signal answer must include live run metadata:

- source;
- run id;
- fetched at;
- tool status;
- cache status if any;
- stale threshold;
- error if live fetch failed.

If cache is used, the model should know it is cache. It should never present it as live.

### Review and approval

Borrow Hermes' write gates:

- memory approval: staged proposal before entering durable user memory;
- skill/playbook approval: staged diff or summary before playbook changes;
- revoke/delete: user can remove memories and playbook changes;
- audit: every durable item has evidence and source turn id.

Recommended modes:

- `off`: no learning.
- `manual`: only explicit "remember this" requests become proposals.
- `review`: passive proposals are staged for user review.
- `auto_low_risk`: low-sensitivity preferences can be saved automatically, private/secret data requires approval.

For privacy-sensitive ReSono usage, default to `review` or `manual` until product policy is settled.

### Security and privacy requirements

Minimum safeguards:

- prompt-injection scanning on memory/playbook content before prompt injection;
- no tool result bodies persisted as memory by default;
- no secrets in memory or playbooks;
- field-level sensitivity labels;
- per-user encryption at rest in the chosen data store;
- delete/revoke cascades from evidence to observations;
- export/delete controls;
- tenant isolation;
- trace ids for every learning write;
- no cloud sync of vault private raw events unless the user explicitly chose cloud storage.

For ReSono's Cloud/Vault split:

- Cloud can store settings, auth state, feature flags, and routing metadata.
- Vault should store private event streams, derived observations, session archives, and signal outputs when the user selected Vault.
- Browser should hold only short-lived session state, ephemeral tokens, and local trust/session markers.
- Cloud should not receive private raw transcript, email, calendar, or radar bodies for Vault users.

### Data tables or collections

Future store adapters should be able to implement these logical collections:

- `learning_events`: append-only raw events.
- `learning_queue`: derivation work items.
- `learning_derivation_runs`: model/job attempts and errors.
- `learning_observations`: compact derived facts/preferences/rules.
- `learning_representations`: cached prompt-ready views.
- `learning_proposals`: staged memory/playbook changes.
- `signal_playbooks`: procedural signal knowledge.
- `session_search_index`: optional FTS/vector index over private session archives.
- `learning_audit_log`: who/what wrote or revoked durable learning.

### Voice Module hooks

The generic WebRTC module should expose hooks, not storage:

- `onSessionCreated(session)`;
- `onRealtimeEvent(event)`;
- `onUserTranscriptFinal(text, metadata)`;
- `onAssistantTranscriptFinal(text, metadata)`;
- `onToolCallStarted(call)`;
- `onToolCallCompleted(result)`;
- `onToolCallFailed(error)`;
- `onTurnCompleted(turn)`;
- `onSessionEnded(summary)`.

The backend can call `LearningProvider.recordEvent()` from each hook when a provider is configured.

### Suggested tools

If the agent is allowed to call learning tools directly, use a small surface:

- `learning_lookup(query, scope?, signalId?)`: retrieve relevant approved observations.
- `learning_propose(kind, content, scope, evidenceEventIds)`: stage a durable memory/playbook proposal.
- `learning_feedback(observationId, rating, note?)`: mark useful/wrong/stale.
- `learning_forget(observationId)`: revoke/delete a durable item.

Do not expose raw database mutation tools to the model.

### Caching policy

Learning context and live data cache must be separate.

Allowed:

- cache embeddings for observations;
- cache working representations with invalidation after new approved observation;
- cache startup memory block for the session;
- cache prefetch result for the next turn only.

Not allowed:

- answer email/calendar/radar/news from long-term memory;
- store raw signal results as durable "facts" without explicit review;
- hide cached age from the model or user;
- let memory override a failed live tool call.

## Implementation phases

### Phase 1: contract only

- Add `LearningProvider` interface.
- Add `NullLearningProvider`.
- Add event types.
- Add backend hooks around voice session lifecycle.
- Add context injection helper that fences learning context.
- Document that no learning is stored unless a provider is configured.

### Phase 2: local reference provider

- Add a simple local SQLite provider for development.
- Store events, observations, and proposals.
- Add manual `learning_lookup`.
- Add a CLI or small endpoint to inspect queue/proposals.

### Phase 3: background deriver

- Add queue worker.
- Batch events by user/signal/session.
- Emit explicit facts and preferences first.
- Require evidence event ids.
- Add dedupe.
- Add queue status.

### Phase 4: signal playbooks

- Add `SignalPlaybook` model.
- Add staged playbook proposals.
- Add approval/reject flow.
- Inject active playbook snippets into signal sessions.

### Phase 5: production store adapters

- Implement Vault provider.
- Implement Cloud provider if needed.
- Keep a strict boundary so the selected data store owns private events and observations.
- Add retention, export, delete, and audit workflows.

## Practical ReSono examples

Email:

- Learn: "User prefers email triage grouped by urgent/client/internal/newsletter."
- Live tool still required: fetch unread/recent emails at run time.
- Playbook: "When asked to read email, call live email search first, include received time and sender, never rely on prior brief."

Daily radar:

- Learn: "User wants radar to include market, AI product launches, and local operational risks."
- Live tool still required: run news/weather/calendar/connection tools according to the configured radar.
- Playbook: "Every radar item must include source and timestamp."

Daily brief:

- Learn: "User prefers concise morning brief with calendar conflicts first."
- Live tool still required: calendar/email/weather/news.
- Playbook: "If a live tool fails, report the failure and continue with remaining sections instead of using stale content."

Automation:

- Learn: "User wants low-noise notifications; only alert on changes or failures."
- Runtime still required: scheduled job execution with audit, tool runs, delivery status.
- Playbook: "Use silent/no-change behavior where supported."

## Do not copy blindly

Do not copy a tiny file-backed memory store as the only ReSono memory system. It is useful for bounded profiles, but ReSono needs private multi-signal evidence, queue status, deletion, and Vault/Cloud adapters.

Do not copy a dialectic chat interface as the only memory interface. It is useful, but ReSono also needs explicit signal runtime contracts and live data freshness guarantees.

Do not allow background self-improvement to silently rewrite user-facing signal behavior without approval while the product is still stabilizing.

## Recommended first implementation for the Voice Module

1. Add the `LearningProvider` TypeScript contract to the module docs and backend typing.
2. Ship `NullLearningProvider` as default.
3. Add event hooks to the WebRTC session backend.
4. Add a learning context formatter with fencing.
5. Add documentation examples for Vault and Cloud adapters.
6. Do not persist by default in the generic module.

This gives ReSono a clean path to Honcho-style background learning and Hermes-style procedural improvement without coupling the generic voice module to one storage product or accidentally treating stale memory as live signal data.
