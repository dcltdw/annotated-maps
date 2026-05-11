# Agent-spec file schema

Every file in `docs/agent-spec/` (other than `README.md`, `00-overview.md`, this file, and the `decisions/` subdirectory) is one requirement and conforms to the contract below. The contract is enforced by **review**, not by tooling — the format exists so an AI agent can grep predictable section headers, not so a validator can fail a CI job.

## Filename

- Functional requirement: `F-NNN-short-slug.md` (e.g. `F-003-edge-create-ux.md`).
- Non-functional requirement: `NF-NNN-short-slug.md` (e.g. `NF-005-permission-model.md`).
- `NNN` is zero-padded, three digits, monotonically increasing per type.
- Slug is kebab-case, ≤ 6 words, no trailing punctuation.

## Frontmatter

YAML at the top of every file:

```yaml
---
id: F-003                       # matches filename prefix
title: Edge create + edit UX
type: functional                # one of: functional | non-functional
status: proposed                # one of: proposed | in-progress | shipped | deferred
issue: 199                      # tracking GitHub issue number
pr: null                        # the implementing PR number (set when work lands)
depends_on: [F-001, NF-002]     # other spec IDs; empty list if none
owner: dcltdw
last_updated: 2026-05-11
---
```

Required keys: `id`, `title`, `type`, `status`, `issue`, `owner`, `last_updated`. Optional: `pr` (null until merged), `depends_on` (empty list if none).

### Status transitions

- `proposed` → `in-progress`: the implementing PR is open.
- `in-progress` → `shipped`: the implementing PR is merged. Set `pr:` to the merged PR number.
- `proposed` → `deferred`: rolled to a later issue or dropped. Retain the file for history.

### Status vs. board

The "Focus on next" project board is **authoritative** for live state. Spec frontmatter `status` is a point-in-time snapshot "current as of `last_updated`". The two may briefly disagree:

- A PR opens at 10:00 → board moves Todo → In Progress immediately, per §2. Spec frontmatter still says `proposed` until the PR's diff touches the spec to update both `status` and `last_updated`.
- A PR merges at 14:00 → board moves In Progress → Done immediately. Spec frontmatter typically transitions in the **same** PR (since the PR itself sets `status: shipped` and `pr: NNN`).

Don't try to keep the two in lockstep on intermediate state. **The board is the source of truth for status; the spec is the source of truth for behaviour.**

## Body sections

Every spec body has the following H2 sections, in this order, with these exact titles:

1. `## Summary` — one-paragraph plain-language description.
2. `## Inputs` — bullet list of inputs to the system component (data, configs, env vars, upstream feeds, user actions).
3. `## Behaviour` — numbered list of observable behaviours. Each item is a single sentence.
4. `## Outputs` — bullet list of outputs (UI surfaces, log lines, API responses, downstream signals).
5. `## Edge cases` — bullet list of named edge cases, each with a one-line handling rule.
6. `## Out of scope` — explicit non-goals (helps future readers understand why the spec is small).
7. `## Verification` — how this is verified: which tests, which manual smoke check. Cross-link to test files.
8. `## Open questions` — bullet list, or `_None._`.

A **non-functional** spec replaces `## Behaviour` with `## Properties` (the cross-cutting invariants the system must maintain) and otherwise follows the same shape.

## Granularity

**One spec per coherent user-facing capability**, not per controller method, not per source file.

A worked example: the Edges epic (issue #148) shipped as **5 sub-tickets** (#148 backend CRUD, #197 visibility filter, #198 frontend render, #199 create/edit UX, #200 detail-panel section). Each is one coherent capability from the user's perspective and would be one F-NNN spec:

- F-NNN edge-crud-backend (the API)
- F-NNN edge-visibility-filter (a non-functional property of edge listings — so actually NF-NNN)
- F-NNN edge-render-layer (the map visualization)
- F-NNN edge-create-edit-ux (the toolbar gesture + modal)
- F-NNN edge-detail-panel-section (the per-node Edges list)

**Don't** create one spec per controller method (`F-NNN edge-create`, `F-NNN edge-update`, `F-NNN edge-delete`); CRUD on a single resource is one capability.

**Do** split when the user-facing surface is genuinely different — visibility filtering is a non-functional concern that applies to many endpoints; modal UX is a frontend capability distinct from the backend it talks to.

## Cross-linking

- Cite other specs as `[F-NNN](./F-NNN-short-slug.md)` or `[NF-NNN](./NF-NNN-short-slug.md)`.
- Cite the implementing issue as `#NNN` (GitHub auto-links).
- Cite source-of-truth conventions as `§N` against [docs/AI-COLLABORATION-CONVENTIONS.md](../AI-COLLABORATION-CONVENTIONS.md).
- Cite test files by repo-relative path, e.g. `backend/tests/test_29_edges.py::test_create_edge`.

## Retroactive specs

When backfilling a spec for already-shipped work (NF-001 below is an example), set:

- `status: shipped`
- `pr:` the merged PR number that delivered the behaviour
- `last_updated`: the backfill date, not the original ship date

Document in the spec body that this is a retroactive capture — the goal is to lock in current behaviour, not to litigate the original implementation.

## Lifecycle

- A spec for **new** work lands in the implementing PR, or in a preceding PR if the spec discussion is itself the load-bearing review (e.g., for a contentious or cross-cutting design).
- A spec is updated when the corresponding code changes; if the spec falls out of sync, that is a bug worth filing.
- The doc-as-master convention (§8 of [AI-COLLABORATION-CONVENTIONS.md](../AI-COLLABORATION-CONVENTIONS.md)) applies: this schema is the master; any memory or other replicas point back here.
- §4b-3 binds: the PR that changes a behaviour described in a spec must update that spec in the same diff.

## Example skeleton

```markdown
---
id: F-NNN
title: <short title>
type: functional
status: proposed
issue: <issue number>
pr: null
depends_on: []
owner: dcltdw
last_updated: 2026-05-11
---

## Summary

<one paragraph>

## Inputs

- <input 1>
- <input 2>

## Behaviour

1. <behaviour 1>
2. <behaviour 2>

## Outputs

- <output 1>

## Edge cases

- **<name>**: <handling>

## Out of scope

- <non-goal>

## Verification

- `backend/tests/test_<area>.py::<test_name>` covers <scenario>.
- `frontend/tests/e2e/<spec>.spec.ts` covers <scenario>.
- Manual: <observable check>.

## Open questions

_None._
```
