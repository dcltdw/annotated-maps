# Decision records

ADR-style ("Architecture Decision Record") one-paragraph-per-decision files. Captures the **WHY** behind major architectural choices so future agents and humans don't re-litigate settled questions.

These are **frozen-in-time** by intent: a decision record is the snapshot of *why a choice was made at a given moment*. If the decision is later revisited and changed, file a new record (`NNN-revisit-…`) that supersedes the prior one. Don't edit the original except to add a `Superseded by:` line at the top.

## Filename

`NNN-short-slug.md` where `NNN` is zero-padded, three digits, monotonically increasing. Slug is kebab-case, ≤ 6 words.

## Frontmatter

```yaml
---
id: 001
title: Edges have no per-edge visibility tags
date: 2026-05-08
status: accepted          # one of: accepted | superseded
supersedes: null          # NNN of a prior decision this replaces, or null
superseded_by: null       # NNN of a later decision that replaces this, or null
---
```

## Body sections

Every decision record has these H2 sections in this order:

1. `## Context` — what prompted the decision; what was the unsettled question.
2. `## Decision` — the chosen path, stated affirmatively.
3. `## Alternatives considered` — bullet list of options rejected, with one-line reasons.
4. `## Consequences` — what this commits us to; what becomes harder; what becomes easier.

Keep each section short. A decision record is not a design doc — it is a pointer to the design's load-bearing choice, recorded so the choice doesn't have to be made again.

## Cross-linking

- From a spec (`F-NNN` or `NF-NNN`): link to the relevant decision when behaviour depends on it.
- From a decision: link to the spec it constrains.

## Candidates for early backfill

(Filed as a separate ticket — not part of the scaffold PR. Listed here so an agent can prioritise.)

- The nodes-rebuild (Phase 2, branch `nodes-rebuild`): why we replaced `annotations` + `note_groups` with the `nodes` + `node_visibility_tags` tree.
- Edges have no per-edge visibility tags (visibility derived from endpoints): see commentary in #148 / #197.
- Coordinate systems as a fixed-at-creation tagged union (vs. mutable / multi-CRS).
- Recursive CTE for visibility resolution (vs. denormalized closure table).
- Zod at the frontend API boundary (vs. trusting backend types).
- Drogon C++ for the backend (vs. Go / Rust / Node).
