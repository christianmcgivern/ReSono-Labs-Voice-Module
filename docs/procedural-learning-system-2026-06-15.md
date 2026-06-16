# Procedural Learning System

Date: 2026-06-15

This document defines the general learning system for reusable procedures, signal playbooks, and automation behavior. It is separate from memory. Memory stores facts and preferences. Procedural learning stores how to perform a class of work.

## Purpose

Procedural learning helps the agent improve recurring workflows without stuffing every lesson into the user profile.

Examples:

- User preference memory: "User wants concise daily briefings."
- Procedural learning: "Daily Brief should run calendar, then email, then weather, then news, and report failures per section."
- Signal preference memory: "User wants Daily Radar to include AI product launches."
- Procedural learning: "Daily Radar requires source title, source URL, fetched_at, and cache status for every item."

## Core objects

### Signal playbook

A signal playbook defines how a signal should run.

Fields:

- id;
- signal id;
- title;
- trigger conditions;
- required tools;
- optional tools;
- procedure;
- freshness rules;
- failure handling;
- output format;
- examples;
- version;
- approval status;
- updated timestamp.

### Workflow rule

A workflow rule is a small reusable instruction that can apply across signals.

Examples:

- "If live email lookup fails, report the failure instead of using stale memory."
- "For privacy mode, do not send raw private event bodies to Cloud."
- "If user asks for current status, prefer live tool calls over summaries."

### Learning proposal

A proposal is a staged change to memory or procedure.

Fields:

- proposal id;
- proposal type;
- target object;
- proposed content;
- evidence event ids;
- risk level;
- created_by;
- created_at;
- status;
- reviewer decision.

## Background review

A background review process can inspect a completed session and propose learning updates.

It should answer:

- Did the user express a durable preference?
- Did the user correct the agent's behavior?
- Did a tool or signal workflow fail in a repeatable way?
- Did the session reveal a reusable procedure?
- Did an existing playbook need a patch?

It should not write active learning directly unless policy permits it. In privacy-sensitive deployments, it should create proposals.

## Review safety

Background review must be isolated from the main session.

Recommended constraints:

- use a limited tool allowlist;
- no arbitrary shell or private data access;
- no direct live signal runs unless explicitly needed;
- no memory-provider side effects except staged proposals;
- no compression/session rotation side effects;
- no hidden user-visible output except a short summary of staged changes.

## Playbook write gates

Before a playbook update becomes active:

- confirm it is a class-level rule, not a one-off task narrative;
- confirm it improves future behavior;
- confirm it does not encode temporary setup failures as permanent rules;
- confirm it does not weaken privacy or freshness requirements;
- confirm it does not shadow live signal tools with stale data;
- require user/admin approval for high-impact changes.

## Signal freshness rules

Every signal playbook should declare freshness expectations.

Examples:

- Email: live lookup required unless the user explicitly asks for previous results.
- Calendar: live lookup required for today's schedule and upcoming events.
- Weather: live lookup required for current or forecast data.
- News: source timestamp required; stale cache must be labeled.
- Daily Radar: every item needs source, fetched_at, and cache status.
- Daily Brief: if a section fails, report the section failure and continue.

## Automation learning

Automation should use playbooks, not ad hoc memory.

An automation definition should include:

- schedule or trigger;
- enabled signals;
- data-store mode;
- tool permissions;
- playbook version;
- delivery target;
- noise policy;
- failure policy;
- audit logging;
- manual-run option.

Procedural learning can propose automation improvements:

- reduce noisy notifications;
- add missing source timestamps;
- split failing workflow sections;
- add fallback ordering;
- improve manual-run output.

Procedural learning must not silently enable new private-data tools or new delivery targets.

## Versioning

Use versioned playbooks so behavior changes are auditable.

Recommended:

- append-only version history;
- active version pointer;
- rollback to prior version;
- changelog entry for each update;
- evidence links to session/tool events;
- reviewer id for approved changes.

## Runtime use

At session start:

- load only playbooks for enabled signals;
- include compact playbook summaries, not entire histories;
- include strict live-data rules;
- include user-approved preferences.

During tool execution:

- record tool metadata;
- record failure categories;
- propose procedural updates only after the turn/session completes.

After session:

- run background review if enabled;
- stage memory and playbook proposals;
- expose proposals to the user/admin for approval.

## Minimal module hooks

The Voice Module should expose hooks rather than own the full learning system:

- onSessionCreated;
- onUserTranscriptFinal;
- onAssistantTranscriptFinal;
- onToolCallStarted;
- onToolCallCompleted;
- onToolCallFailed;
- onTurnCompleted;
- onSessionEnded.

Product integrations can connect these hooks to Cloud, Vault, or local stores.

## Non-goals

- Do not make the generic module a full automation platform.
- Do not persist private learning by default.
- Do not silently mutate signal behavior from a single conversation.
- Do not let procedural learning override live-data freshness.
- Do not store secrets or raw private tool results in playbooks.
