# Agent spec

Structured specifications, designed to be consumed by both humans and AI agents working on this repository. Files in this directory follow the contract in [schema.md](schema.md).

## Why this exists

Narrative docs ([REQUIREMENTS.md](../REQUIREMENTS.md)) are great for humans but bad for automation: an agent cannot reliably tell "the relevant section for the click-on-map placement gesture" from a long prose document. The agent-spec format trades narrative flexibility for machine-readable structure:

- Each file is one requirement.
- Each file has YAML frontmatter declaring its ID, type, scope, status, and linked issue/PR.
- Each file has the same H2 sections in the same order, so an agent can grep for any of them.

Two use cases drove the format:

1. **Onboarding new agents** — a fresh agent session can grep a fixed schema for the exact requirement it cares about, instead of reading a long narrative doc end-to-end.
2. **Disaster recovery** — the repo + git mirrors are the real DR. This catalog is a complementary, durable record of behaviours, edge cases, and rationale that an agent + human team could use to rebuild.

## File layout

- `README.md` — this file.
- `schema.md` — the schema contract every spec follows.
- `00-overview.md` — system orientation (stack, repo layout, mental model). Not a numbered spec; the only doc here you read end-to-end at session start.
- `F-NNN-<slug>.md` — functional requirement (user-facing behaviour or system capability).
- `NF-NNN-<slug>.md` — non-functional requirement (cross-cutting properties — visibility, error shape, audit, rate limits, etc.).
- `decisions/` — ADR-style decision records. One file per decision. Frozen-in-time history; the "WHY" behind the system.

`NNN` is a three-digit zero-padded sequence number scoped to the type (functional or non-functional). Slug is kebab-case, ≤ 6 words. See [schema.md](schema.md) for the full contract.

## When to read what

| You are… | Start here |
|---|---|
| A new agent picking up a task | `00-overview.md`, then grep `F-NNN`/`NF-NNN` for your area |
| Doing disaster recovery | Read in order: `00-overview.md` → all `NF-NNN` (cross-cutting first) → `F-NNN` by area → `decisions/` for rationale |
| Filing a new feature ticket | Read `schema.md` and pick the next sequential `F-NNN` |
| Auditing a decision's rationale | `decisions/` |

The narrative companion at [docs/REQUIREMENTS.md](../REQUIREMENTS.md) remains the human-readable capability list. It cross-references this directory.

## Workflow

1. **New requirement surfaces** — file an issue first; add it to the "Focus on next" project board per [docs/AI-COLLABORATION-CONVENTIONS.md](../AI-COLLABORATION-CONVENTIONS.md) §3.
2. **Write the spec** — create `F-NNN-<slug>.md` or `NF-NNN-<slug>.md` in this directory with `status: proposed` and the issue number in frontmatter. The spec can land in its own PR (for big features where the spec discussion is itself the work) or in the implementing PR (small features).
3. **Implementation PR** — when work starts, transition `status: proposed` → `in-progress`. When the PR merges, transition to `shipped` and set `pr:` to the PR number. Update `last_updated`.
4. **Spec drift** — if code changes after the spec is shipped, the same PR that changes the code must update the spec (per §4b-3, the spec-alongside-code rule).

Status authority: the project board column is the live state. Spec frontmatter `status` is "current as of `last_updated`" and may briefly lag. Don't dual-write transitions atomically; let the board drive and let the spec catch up at `last_updated` time. See [schema.md](schema.md#status-vs-board) for full discussion.

## Current specs

| ID | Title | Status |
|---|---|---|
| F-001 | Click-on-map location placement | proposed |
| NF-001 | Backend error response shape | shipped |

(Updated as specs land; backfill of historical capabilities is tracked separately — see the issue that introduced this directory.)
