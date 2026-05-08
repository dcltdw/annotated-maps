# AI-Agent Collaboration Conventions

Process conventions for working with an AI coding agent (e.g., Claude Code,
Cursor, Aider) on a real software project. Distilled from the `nodes-rebuild`
work on annotated-maps; the rules are written portably so they transfer to
any project, with project-specific bits flagged in **How to apply** sections.

These conventions overlap meaningfully with three established frameworks —
**Definition of Done** (Scrum/Agile), **Google's "Small CLs" guidance**
([eng-practices](https://google.github.io/eng-practices/review/developer/small-cls.html)),
and **Trunk-Based Development**'s feature-branch guidance
([trunkbaseddevelopment.com](https://trunkbaseddevelopment.com/)). Where
relevant, that overlap is noted under each rule.

---

## Quick reference (portable rule list)

Copy these statements verbatim into another project's CLAUDE.md / system prompt /
agent instructions:

1. **Size every ticket to fit a single PR.** Split aggressively up front; many
   small tickets beats a few "natural" ones that don't land cleanly.
2. **Move ticket status as work progresses:** Todo → In Progress when the PR
   opens; In Progress → Done when the PR merges.
3. **Add every new issue to the project's default board** (whichever board
   represents "what we're working on now").
4. **Every PR body must include the following sections** (each detailed
   below): `Files changed` (§4a, alphabetical), docs/tests updates verified
   (§4b, with §4b-1 cross-cutting docs and §4b-2 E2E for new CRUD pages),
   `Test expectations` table only when failures are expected (§4c),
   `Work breakdown` mirroring the agent's task-tracker (§4d), and
   `Operational impact` (§4e, restart / rebuild / migration needs, or
   "none"; skip for pure doc/test PRs).
5. **Stamp commits with the current AI model name** (not a previously-used
   string) in the `Co-Authored-By:` trailer.
6. **Scan the actual diff for secrets, PII, and internal references before
   opening every PR** in a public repository.
7. **For long-running branches, extending the CI workflow to trigger on
   the branch is action #1**, before any feature ticket starts.
   Subtype — **wave branches**: name them `wave-N-<short-slug>` and
   `pr-tests.yml`'s `wave-*` glob picks them up automatically (no
   workflow patch needed).
8. **This document is the master record; agent-memory entries are thin
   replicas pointing back here.** When a rule changes, edit the doc; the
   memory pointer's frontmatter is updated to match.
9. **When a cached operational value fails with a staleness-pattern error
   (404 / "not found" / "no such resource"), re-derive from the live
   source and update the cache before retrying.** Don't blindly retry,
   don't ask the user — refresh on first failure, escalate only if the
   fresh value also fails.
10. **Every 10 PRs into a tracked branch (`main` and any long-running phase
    branch), perform a midpoint audit:** doc+test audit of the divergence
    range per §4b-1/§4b-2, plus trigger `weekend.yml` against the branch HEAD.
    Each audited branch has a dedicated tracking issue; comment the audit
    result there so the next audit knows where to start counting.
11. **When opening multiple independent PRs autonomously in a single
    session ("burst mode"), follow the burst checklist:** pre-burst dep
    audit, run the *whole* affected spec suite locally before each PR
    opens (not just the new spec — sibling tests can break on shared
    selectors), status update every ~3 PRs to a tracking issue,
    end-of-burst CI sweep (`gh pr checks` per PR), end-of-burst
    `weekend.yml` against the trunk. Skip-rather-than-guess on mid-burst
    scope ambiguity.

---

## Ticket and project-board hygiene

### 1. Size tickets to fit a single PR

> **Rule:** When filing tickets that will later be implemented by an AI agent,
> size each one so the work fits comfortably in a single PR without risking
> streaming-API idle timeouts. Split aggressively up front rather than
> mid-implementation.

**Why:** During the `nodes-rebuild` work, ticket #82 was originally one bundle
(schema + new controller + tests). Mid-implementation we hit the streaming-API
idle timeout, had to split it into #82 + #96 retroactively, and then re-evaluated
#83–#95 and discovered five more tickets needing the same treatment (resulting
in #98–#106). The pattern is predictable: backend tickets touching multiple
controllers, anything with recursive CTEs, anything mixing backend + frontend,
and any wholesale UI rewrite are all at high risk. Splitting up front saves the
mid-PR rework.

This overlaps with [Google's "Small CLs"](https://google.github.io/eng-practices/review/developer/small-cls.html)
guidance — read that doc for the orthogonal-but-aligned argument that small
PRs are also better for human review. Our version is timeout-driven; theirs is
review-quality-driven. Both reach the same conclusion.

**How to apply:**

- **Calibration point:** for the AI agent's streaming context, a PR around
  25–30 files / +1100 / -2200 lines runs close to the timeout. Anything bigger,
  or anything with extra build/test iteration cycles, is risky.
- **Default split heuristics:**
  - "Data + management API" tickets (CRUD + members + auth helper + bootstrap)
    → split CRUD vs. supporting ops.
  - "Tagging + filtering" tickets where filtering needs a recursive CTE →
    split write-side from read-side filtering.
  - "Move + copy" tickets → always two tickets (copy is recursive duplication,
    a different shape from re-parenting).
  - Frontend tickets that mix Zod foundation + UI rewrite + E2E rewrite → at
    least three tickets.
  - Tickets that touch both backend and frontend → split unless trivially small.
- **One controller + its tests** is usually a safe single-ticket unit. Anything
  beyond that, ask: does this need splitting?
- Cross-link the splits in ticket bodies (".b depends on .a"); trim the
  parent's task list when splitting; mark out-of-scope items.

### 2. Update ticket status on the project board

> **Rule:** When working on tickets tracked on a project board, move the Status
> field through Todo → In Progress → Done as work progresses. Default cadence:
> In Progress when the PR is opened; Done when the PR is merged.

**Why:** The board is the canonical view of "what's happening right now."
Leaving stale statuses there means the human collaborator can't trust it for
at-a-glance status, and they end up doing manual cleanup that should have been
the agent's job. Cheap habit fix; avoids a recurring papercut.

This is essentially a Kanban WIP-discipline rule — see any Kanban guide for
the canonical Todo → In Progress → Done flow.

**How to apply:**

- **Todo → In Progress:** when the PR opens. Earlier transitions
  ("starting to think about it") aren't useful — open-PR is a clear,
  observable trigger.
- **In Progress → Done:** when the PR merges. Usually triggered by the human
  saying "PR merged"; that's the cue to flip both sides.

**Long-running branch caveat:** GitHub's auto-close-on-merge only fires for
the default branch. PRs into a long-running branch (e.g., `nodes-rebuild`)
do NOT auto-close their linked issues, even with `Closes #N` syntax. After
merging into a long-running branch, **both** of these are manual:

1. Close the issue (`gh issue close NNN --comment "..."` — explain the
   long-running-branch context).
2. Flip the board status to Done.

**How to make this interruption-resistant:**

A "PR merged" message often arrives in the same turn as a "proceed to the
next task" instruction. The natural failure mode is to jump straight into
exploring the next ticket and forget the cleanup — *especially* if the
next task triggers a clarifying question that diverts the conversation.
The cleanup steps live entirely in the agent's head until they're done,
so any interruption can drop them.

**The fix:** when a "PR merged" message arrives, the *first* tool call
must be a `TodoWrite` capturing the cleanup checklist *before* any
exploration of the next task. Concretely:

1. **First action**: `TodoWrite` with two pending items at the top:
   - "Close issue #NNN (long-running branch — auto-close didn't fire)"
   - "Move #NNN board status to Done"
2. Execute those two items, marking each completed as you go.
3. *Then* start the next task (which may itself open with a clarifying
   question — fine, the cleanup is already done).

Why this works: the todo list survives across model responses. Even if
the next-task work triggers a clarifying question, even if the user
replies with something unrelated, even if the conversation context
shifts entirely, the unchecked cleanup items remain visible at the top
of every turn. The runtime's periodic "TodoWrite hasn't been used
recently" reminders also resurface stale lists. By contrast, a cleanup
step that lives only in the agent's narrative response has no such
durability — once the response is sent, it's gone.

**Skip the TodoWrite only if**: the merged PR was into the default
branch (`main`) AND the issue auto-closed (visible in the user's
message or trivially confirmable). In that case the only manual step
is the board flip — fine to do as a single direct tool call without
the list overhead.

**Always verify after any `gh` command that affects the project board.**
Multiple `gh` invocations can silently no-op the board side-effect:
exit code 0, no output, no actual change. Confirmed instances:

- **`gh project item-edit ...`** — first board flip during the #106
  cleanup returned cleanly but the status stayed at In Progress.
  Spotted only when the user noticed the wrong state on the next turn.
- **`gh issue create --project "Focus on next" ...`** — the project
  assignment silently dropped during the #146 file (post-merge
  cleanup ticket). Required a follow-up `gh project item-add` and a
  verification read.

The fix is cheap: every board-affecting `gh` invocation should be
paired with an immediate read-back. Either chain them in one shell
command (`gh project item-edit ... ; gh project item-list ... --jq
'.items[] | select(.content.number == NNN) | .status'`) or run a
follow-up read tool call. The board's eventual-consistency window is
short — a synchronous check in the same turn is sufficient.

Apply the same pattern to **any new board-affecting `gh` invocation**
encountered going forward — silent no-ops appear to be a generic
property of this CLI surface, not isolated to the two commands above.
Don't mark the corresponding TodoWrite item completed until the read-
back returns the expected state.

**Delete the local feature branch after the PR merges.** When this
collaborator merges PRs they configure GitHub to delete the remote
branch automatically; the local branch persists with a `: gone`
upstream marker (visible in `git branch -vv`). These accumulate fast
on a long-running project and clutter both `git branch` output and
the agent's mental model of "what's still in flight." Add to the
post-merge TodoWrite list:

- "Delete local branch \`feature/NNN-...\` (remote was auto-deleted on merge)"

Run `git branch -D <name>` (force, since git can't always confirm the
merge happened — the remote is already gone, and the commits are in
\`main\` already if the PR merged). Skip if the branch is the current
checkout — switch to \`main\` first. Skip the shared long-running
branches (\`main\` plus any active phase branch).

To bulk-prune at any point, the safe one-liner is:

```bash
git fetch --all --prune                         # update : gone markers
git branch -vv \
  | awk '/: gone\]/ { print $1 }' \
  | xargs -r -n1 git branch -D
```

**Project-specific binding (annotated-maps `Focus on next` board):**

```bash
PROJECT_ID="PVT_kwHOAAdfes4BTc5U"            # Focus on next
STATUS_FIELD="PVTSSF_lAHOAAdfes4BTc5UzhAsFXA"
TODO_OPT="f75ad846"
IN_PROG_OPT="47fc9ee4"
DONE_OPT="98236657"
```

These IDs were stable as of 2026-05 (post-`nodes-rebuild` merge). If they
ever drift (project rename, etc.), re-derive via:

```bash
gh api graphql -f query='
{ user(login: "dcltdw") {
    projectV2(number: 1) {
      id
      field(name: "Status") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
    }
} }'
```

When porting to another project, replace these IDs with the equivalents from
your own GraphQL query.

#### 2a. Project-board operations — destructive-mutation traps

Two failure modes from a 2026-05-08 incident, captured here so the next
agent doesn't re-discover them the hard way:

**Trap 1: `updateProjectV2Field` regenerates *all* option IDs.** The mutation:

```graphql
updateProjectV2Field(input: {
  fieldId: "..."
  singleSelectOptions: [
    { name: "Wave 1", color: GRAY, description: "" }
    { name: "Wave 2", color: GRAY, description: "" }
    ...
    { name: "Wave 6", color: GRAY, description: "" }   # the new one
  ]
})
```

…regenerates the `id` of *every* option in the list, even when names
are unchanged. Every previously-tagged item then references a stale
option ID and shows as untagged on the board. Issues themselves are
unaffected; only the project field-value linkage breaks. Recovery
requires re-tagging every item from session memory or git history,
which is a slog and lossy if the original tags weren't captured
elsewhere.

The undocumented quirk: there's no `updateProjectV2Field` variant that
*appends* an option without rewriting the list. The safe path:

- **Use the GitHub web UI** (Project settings → field → "Add option"). The web UI preserves existing IDs.
- The CLI / GraphQL path doesn't have an additive equivalent (verified 2026-05-08).
- If the GraphQL path is unavoidable (e.g., automated provisioning), pre-snapshot all item-tag bindings (`gh project item-list ... --jq '.items[] | "\(.content.number)|\(.fieldValues...)"'`) before the mutation, then re-apply tags from the snapshot afterward.

**Trap 2: GraphQL is rate-limited at 5000/hour with a tighter
secondary per-minute limit.** Every `gh project item-list`,
`item-edit`, and `gh issue create` call hits the GraphQL quota. A
burst of ~25 mutations during a recovery attempt triggered the
secondary limit; the primary was 4/5000 remaining when checked.
Reset window for that incident was **42 minutes**.

How to stay under:

- **Snapshot, then iterate.** Do one `gh project item-list` to dump
  all item IDs into a local file, then loop edits — never re-query
  inside the loop.
- **Throttle destructive bursts.** If doing more than ~50 mutations
  in a sitting, add `sleep 2` between item-edits. Each `sleep 2`
  costs nothing; each rate-limit recovery costs ~42 minutes.
- **Don't combine** a wave-tag refactor (or any mass re-tagging)
  with other destructive board work in the same hour.
- **Check before bursting:** `gh api rate_limit --jq '.resources.graphql'`
  shows remaining + reset epoch; aim for ≥ (intended_mutations + 100) headroom.

When rate-limited mid-burst, the safest move is to stop, log what
was done, and return after the reset — cascading retries against a
limited quota turn a 42-minute wait into a multi-hour one.

**Workarounds that don't use GraphQL.** During a rate-limit window
the following still work because they hit the REST API:

- `gh issue close` / `gh issue reopen`
- `gh issue edit --body / --title` (label edits route through GraphQL — beware)
- `gh api -X POST repos/{owner}/{repo}/issues -f title=... -f body=...` (REST issue create — bypasses `gh issue create`'s GraphQL path; project membership has to be added later)
- All git operations
- All doc edits

### 3. Add every new issue to the default project

> **Rule:** Whenever creating a new issue, add it to the project's default
> "what we're working on" board afterward.

**Why:** All issues should live on one board by default; otherwise, drift
between "filed" and "tracked" creates a backlog of orphan issues that no one
is looking at.

**How to apply:**

```bash
gh issue create --title "..." --body "..."     # produces issue URL
gh project item-add 1 --owner dcltdw --url <issue-url>
```

Replace `1` (project number) and `dcltdw` (owner) with your project's values.

---

## PR body conventions

### 4. Every PR body must include the following sections

> **Rule:** Every PR body must include the sections listed below. Each
> sub-section has its own conventions detailed in §4a–§4e:

| Sub | Section | When to include |
|---|---|---|
| §4a | `## Files changed` | Always |
| §4b | docs + tests verified | Always (state "no docs/tests needed" explicitly if so) |
| §4c | `## Test expectations` | Only when some CI checks are expected to fail |
| §4d | `## Work breakdown` | Always |
| §4e | `## Operational impact` | Always except pure doc-only / test-only / CI-only PRs |

Each sub-rule below carries its own **Rule / Why / How to apply** block.

#### 4a. PR body must include a "Files changed" section

> **Rule:** Every PR body has a `## Files changed` section — a bullet list of
> each file (sorted alphabetically by path) with a one-line summary of changes.

**Why:** Reviewers (and future archaeologists) get a clear at-a-glance map of
what the PR touches without having to click into the diff. The one-line
summaries also serve as a sanity check that the agent understood each file's
purpose.

This is loosely covered by GitHub's own ["Writing a pull request"](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/best-practices-for-pull-requests)
guide, but spelling it out as an alphabetical list with summaries goes
further than most defaults.

**How to apply:** Place the section between the PR's Summary and Test plan.

```markdown
## Files changed

- **backend/src/ControllerA.cpp** — Adds the X helper used by the new endpoint.
- **backend/src/ControllerB.cpp** — Refactors error handling to use shared header.
- **backend/tests/test_42_x.py** — New 12-assertion suite covering X.
```

#### 4b. Always update docs and tests with code

> **Rule:** Every PR must include relevant documentation and test updates.
> Verify both explicitly before opening the PR; don't conclude readiness
> without the check.

**Why:** Docs and tests are easy to skip on refactor PRs (where there's no
behavior change but often new conventions worth documenting), and on
"obviously" simple PRs where the agent's reflex is to declare the work done
once the code compiles. The user has had to re-prompt for both more than
once; a routine check is cheaper.

This is a classic Definition of Done item — most Scrum/Agile DoD checklists
include both "tests updated" and "documentation updated" near the top.

**How to apply:**

Before opening the PR, run through both questions:

- "What docs reference the area I changed? Do they still match?"
- "Are there tests covering the area I changed? Do any need updating?"

For refactors with no behavior change, new shared helpers/patterns still
often warrant a conventions doc (so future devs don't drift back to the old
shape). If truly nothing needs updating, **say so explicitly** in the PR
description — e.g., "No docs/tests updated — refactor preserves behavior
exactly and no convention docs exist yet."

**Two specific gaps the "alongside" wording does NOT catch by default —
treat both as binding extensions of this rule:**

**§4b-1. Cross-cutting docs when adding a new top-level concept.** Adding
a new entity (node, plot, visibility group), a new admin page, a new
domain primitive, or a new top-level API surface — the SAME PR must
update **README.md** (project structure, API table, domain concepts) and
**docs/REQUIREMENTS.md** (the §2 capability list and §5 route tables) for
anything those docs name. Each individual sub-PR may feel narrowly scoped
("I'm just adding NodeController"), but README/REQUIREMENTS describe the
whole system; if no one updates them per-PR, they rot in aggregate. This
is what produced the multi-doc rewrite in PR #178 at the end of the
nodes-rebuild branch — every sub-PR was *locally* compliant with §4b; the
system was *globally* non-compliant because no one owned the cross-cutting
docs.

**§4b-2. New CRUD / admin pages need an E2E spec in the same PR.** Backend
integration tests verify the API contract; they do not verify the
frontend Zod parse, the modal wiring, or that the create-then-list
roundtrip actually works in a browser. PR #178 surfaced a
`createGroup`/`updateGroup` response-shape bug that backend
`test_18_visibility_groups.py` had silently ignored for months because it
asserted on a subset of fields and the only path that exercises the full
schema (Zod `.parse()` on the modal save response) had no E2E coverage.
When a PR adds a new page that does CRUD on an entity through the UI,
ship a Playwright spec covering at minimum: create → list → edit → delete
through the UI, asserting the response renders without error.

**Verify lint/typecheck per-file on the touched files**, not just by
running the project-wide command. ESLint's daemon and watcher caches can
hold a stale "clean" answer for a recently-touched file, so a project-
wide `npm run lint` shortly after writing a file may report 0 errors
even though a fresh CI run will fail on it. Hit twice in a row on
PR #142 (verify-after-board-edit) and PR #144 (the unused-`node` var in
`plots-in-detail-panel.spec.ts` — local lint reported clean, CI caught
it on a cold cache).

**The fix:** before opening the PR, also run the linter directly on the
files in your diff:

```bash
git diff --name-only --diff-filter=AM <base-branch>...HEAD \
  | grep -E '\.(ts|tsx|js|jsx)$' \
  | xargs -r npx eslint --max-warnings 0
```

Or for the smaller per-PR case: `npx eslint <new-or-edited-file>` for
each file you wrote. The cold per-file invocation bypasses the daemon
cache and matches what CI will see. Apply the same belt-and-suspenders
pattern to typecheck if your project has had analogous misses with
`tsc --noEmit`.

#### 4c. PR Test Expectations section (only when failures are expected)

> **Rule:** When some CI checks are expected to fail (e.g., mid-rebuild on a
> long-running branch where one part of the system has outpaced another),
> include a `## Test expectations` table in the PR body listing each
> CI job/sub-step with its expected outcome and a one-line reason. Skip the
> section entirely when everything is expected to pass.

**Why:** Without an explicit expectations table, a reviewer (or future-self)
sees a red CI run and has to reconstruct the design context to figure out
whether it's "fine and expected" or "actual bug." A pre-declared table makes
the review fast: scan, confirm reality matches, move on. Conversely, an
"all green expected" table on every PR would be pure noise — the green
checks themselves convey it.

This is a local invention; I haven't seen it codified in DoD or any
standard PR template. It's most useful on long-running branches where
mid-state inconsistency is expected by design.

**How to apply:**

- Use a small markdown table per CI job (or sub-step within a multi-step
  job like `integration`). Columns: **Job | Expected | Why**.
- Use ✅ pass / ❌ expected fail / 🟡 partial emojis to make the scan fast.
- For each ❌, give a one-line reason that points at the ticket / phase
  that will fix it.
- Mention if the overall job will report red because of one sub-step
  (e.g., `integration` reporting red because E2E fails *inside* it).
  Otherwise reviewers may think the whole job is broken.
- If the long-running branch has different CI gating semantics than `main`
  (e.g., informational only), state it explicitly.

**Example** (historical, from a backend-only PR into the `nodes-rebuild`
phase branch — applies the same way to any future long-running branch
where some CI is expected to fail mid-rebuild):

```markdown
## Test expectations (CI on `<long-running-branch>`)

| Job | Expected | Why |
|---|---|---|
| `lint` | ✅ pass | No frontend changes. |
| `compile` | ✅ pass | New code compiles locally. |
| `integration` (backend) | ✅ pass | 9/9 suites pass locally. |
| `integration` (E2E) | ❌ expected fail | Frontend still references old API; rebuild lands in #92, #101, #102. |
```

#### 4d. Capture the agent's task-tracker breakdown in the PR body

> **Rule:** When opening a PR, include a `## Work breakdown` section that
> mirrors the agent's task-tracker list (e.g., Claude Code's TodoWrite)
> used while implementing the change. The list captures the work
> sequence next to the diff itself, so it stays durable after the
> originating conversation ends.

**Why:** The agent's internal task list captures planning and progress
tracking during a ticket — what was sequenced first, what got added
mid-implementation, where blockers led to course corrections. By
default that list disappears when the conversation ends. Promoting it
to the PR body preserves the trail next to the diff, which is more
durable and more discoverable than the conversation transcript. For
someone reviewing the PR or doing later archaeology ("why was this
split into these particular steps?"), the breakdown is concrete signal
about how the implementation actually unfolded.

**How to apply:**

- Place the section between the PR's **Summary** and **Files changed**
  sections.
- Render as a numbered or bulleted list of the task contents in the
  order they were tackled. Match the granularity the agent actually used
  internally — don't rewrite for the PR. The point is showing the real
  sequence, not a cleaned-up post-hoc narrative.
- By the time the PR opens, every item is done; status emojis are
  redundant. If a task was deferred or abandoned, note it explicitly:
  `~~Add X~~ — deferred to follow-up #NNN`.
- For tasks added mid-implementation (after the initial plan), include
  them in their actual position so the trail reflects reality, not the
  original plan.

**Example** (historical, taken verbatim from a `nodes-rebuild` ticket):

```markdown
## Work breakdown

1. Read NoteController to understand current shape
2. Add tagging endpoints (GET/POST .../notes/{id}/visibility)
3. Build note effective-visibility CTE (note → node → parent chain)
4. Apply filter to listNotes + getNote with admin/xray bypass
5. Build backend
6. Add tagging + filtering integration tests
7. Run tests + iterate
8. Open PR into the active phase branch
```

#### 4e. Surface operational impact (restart / rebuild / migration needs)

> **Rule:** When a change requires a service restart, container rebuild,
> migration, or any other operational step before the change takes effect,
> explicitly state that step in (a) the conversation report when handing
> back to the user, AND (b) a section of the PR body. When a code/config
> change requires NO restart, say so explicitly too — both audiences
> benefit from knowing the agent considered the question. Skip the
> convention entirely for doc-only or test-only PRs (no operational
> impact possible).

**Why:** A change to backend C++ requires `docker compose up -d --build
backend` before the user can exercise it in the running stack. A change
to a Vite-built dependency may need a full container restart instead of
relying on HMR. A schema change may need a migration run or a `down -v`
volume wipe. The user has hit the "I changed something but my browser
shows the old behavior" trap repeatedly when these steps weren't called
out — and a future reader of the PR loses important context if the
restart needed isn't recorded next to the diff. Saying "no restart
needed" when none is needed is also valuable: it explicitly acknowledges
the agent considered the question rather than leaving the reader to
guess whether the agent forgot.

**How to apply:**

In the **conversation report** when handing back work:

- Always include a one-liner about what (if anything) needs restarting
- Frame the answer either as a single sentence or a small table when
  multiple layers are touched (backend / frontend / DB / etc.)
- Examples:
  - "No restart needed — frontend code change picked up by Vite HMR."
  - "Backend rebuild needed: `docker compose up -d --build backend`."
  - "DB action needed: `docker compose down -v && docker compose up -d`
    to apply the schema change (or run the migration explicitly)."

**Branch switches count too.** When the agent switches the local
checkout to a different branch — e.g. branching off `main` for a
small doc PR while the rest of the work is on a long-running feature
branch — the running dev stack's behavior may change immediately:

- **Frontend (volume-mounted)**: Vite picks up the new branch's source
  via HMR within seconds. The browser will start serving the new
  branch's code on next reload (or sooner). If the two branches differ
  in significant ways — e.g. one has a dependency the other doesn't —
  the user may see import errors, missing UI, or unexpected layouts
  immediately, with no other warning.
- **Backend (compiled)**: the running binary is whatever was last
  built. A branch switch alone doesn't change runtime behavior; only
  a `docker compose up -d --build backend` does. So the backend may
  silently be on a different branch's code than the frontend.
- **Database**: unaffected by branch switches at the file level, but
  schema state reflects whichever migrations have actually been run.

When making a branch switch as part of a multi-step task (especially
when the user is expected to interact with the running stack), state
explicitly: "switching from `branchA` to `branchB` — frontend dev
stack will start serving `branchB`'s code; backend binary unchanged
(still on `branchA`'s last build); switch back when this PR closes
out." This prevents the "old code referencing missing dep / new dep
not yet built / API mismatch between layers" surprise.

In the **PR body**, add a section (or fold into an existing section
like a "Test plan" with one bullet) calling out the same:

```markdown
## Operational impact

- **Backend**: rebuild required (`docker compose up -d --build backend`)
- **Frontend**: no restart needed (HMR picks it up)
- **Database**: no schema change
```

If no operational impact at all, a single line is fine:

```markdown
## Operational impact

No restart, rebuild, or migration needed.
```

**When the rule does not apply:**

- **Pure doc PRs** (`docs/*.md`, README updates, comment-only edits)
- **Pure test PRs** that don't touch the production code paths exercised
  by tests (e.g. backend test additions where the controller code is
  unchanged — tests pick up the new test file automatically)
- **Workflow / CI-only PRs** (`.github/workflows/*.yml`) where the
  change only affects future CI runs

For everything else (code, schema, lockfile/dep changes, Dockerfile,
config files, env vars), include the line.

**Origin:** rule established 2026-05-06 after the user pointed out that
they'd hit the "I have to ask whether the backend was rebuilt" pattern
multiple times during the `nodes-rebuild` work and would prefer it be
surfaced proactively. Two-sided: the answer in the conversation
prevents the immediate confusion; the answer in the PR body preserves
the same information for whoever pulls the change later.

**Live test of the rule (same session it was filed):** within minutes
of opening the PR adding this rule, the agent silently violated it.
The agent branched off `main` for the doc PR, leaving the local
checkout on a `main`-based branch. The Docker frontend container's
volume mount immediately served `main`'s pre-rebuild `MapView.tsx`,
which references a `leaflet-draw` dependency the rebuild had dropped.
The user resumed manual smoke testing, hit a Vite import error, and
had to ask the agent to investigate. The branch-switch clause above
was added in response. The pattern generalizes: any change to what
the running stack serves — including filesystem-level changes the
agent makes — counts as operational impact and must be surfaced.

---

## Commits and repo-level practices

### 5. Stamp commits with the current AI model name

> **Rule:** When adding a `Co-Authored-By:` trailer to commits, use the
> actual current model name from the runtime environment — don't copy a
> previously-used string from earlier commits.

**Why:** Stale trailers misrepresent which model produced the change, which
matters for later archaeology ("did we regress after model upgrade X?").
The agent's reflex is to copy the previous commit's trailer verbatim;
that's wrong after any model upgrade.

**How to apply:**

- Before writing the commit-message HEREDOC, check the runtime environment
  for the line that names the active model and use that exact name.
- Format: `Co-Authored-By: Claude <ModelName> (<context-size>) <noreply@anthropic.com>`
  — e.g., `Claude Opus 4.7 (1M context)`.
- If unsure, ask before guessing.

### 6. Public-repo diff scan before every PR

> **Rule:** If the repository is public, scan the actual diff
> (`git diff <base>...HEAD`) for secrets, PII, internal references, and
> debugging leakage before opening every PR.

**Why:** Public repos are visible to the world, indexed by search engines,
and may be cloned by automated bots within minutes of pushing. Doing a
small diff-scan once per PR is cheap; finding a leaked credential in commit
history later is expensive (history rewrite + credential rotation).

This aligns with [OpenSSF Scorecard](https://github.com/ossf/scorecard) and
the broader "secrets in commits" hygiene that tools like
[gitleaks](https://github.com/gitleaks/gitleaks) automate. Treat the manual
scan as defense-in-depth, not the only line of defense.

**How to apply:**

Before `gh pr create`, scan the diff and check for:

- **Live credentials:** `sk_live_`, `AKIA*`, `xoxb-`, `ghp_`, `glpat-`,
  real passwords (anything that's not a documented dev placeholder),
  real JWT secrets, OAuth `client_secret` values, SSH/TLS keys.
- **PII:** real names other than the project owner's public identity,
  real email addresses, phone numbers, physical addresses.
- **Internal references:** internal hostnames (`*.internal`, `*.local`),
  private-range IPs (10.x, 172.16-31.x, 192.168.x), references to internal
  Slack/JIRA/Linear/etc.
- **Debugging leakage:** `console.log` / `println!` / `std::cerr` calls
  that dump secrets, tokens, request bodies, or full user objects.
- **Embarrassing content:** profanity, hot-takes about specific named
  people/companies, internal-team-only humor.

If anything ambiguous turns up, ask before pushing.

**Beyond pre-PR scanning:**

- Confirm new files are added to `.gitignore` *before* they're created;
  don't rely on remembering later.
- Document third-party code attributions in code comments and project
  manifests.
- Avoid committing temporary debug files (`*.log`, `tmp_*.txt`, etc.).

### 7. Long-running branches — extend CI as action #1

> **Rule:** When creating a long-running branch (a "rebuild" / "phase-N"
> branch where many PRs will land before merging back to main), the very
> first action on that branch is a CI workflow extension PR. Do this BEFORE
> any feature ticket starts.

**Why:** During the `nodes-rebuild` work, the branch was created and a
large schema-rewrite PR (#97) sat without any CI verification because
`pr-tests.yml` only triggered on PRs into `main`. The gap was discovered
later, requiring two follow-up PRs (#108 to main + #109 to nodes-rebuild)
to retrofit CI plumbing — and then the original PR had to be re-triggered.
The work was right; the sequence wasn't.

[Trunk-Based Development guidance](https://trunkbaseddevelopment.com/short-lived-feature-branches/)
explicitly covers the case where pure trunk-based isn't viable and you need
a long-running branch. CI gating on that branch is one of the trade-offs
it tells you to think about up front, not retroactively.

**How to apply:**

For the **wave-branch** subtype (a tightly-scoped multi-PR effort that
will merge back to main as a unit — the most common case in this repo),
follow the wave naming convention in §7a; `pr-tests.yml`'s `wave-*` glob
trigger picks the branch up automatically and no workflow patch is needed.

For **other** long-running branches (one-off rebuilds, phase branches
that won't fit the `wave-N-<slug>` pattern), the *first* deliverable is
a tiny PR that extends the project's CI workflow (e.g.,
`.github/workflows/pr-tests.yml`) to:

1. Add the branch to the `pull_request: branches: [...]` list.
2. Add a `push: branches: [...]` trigger so post-merge state is also verified.

Land that change on **both** `main` (canonical convention) and the
long-running branch — for `pull_request` events, GitHub Actions reads the
workflow from the **base branch's tip**, so it has to exist on the long-running
branch for PRs *into* the branch to fire.

For the long-running branch, decide upfront whether CI is **enforced**
(branch-protection ruleset) or **informational** (no ruleset). For active
rebuild branches where mid-state failures are expected, informational is
usually right; `main` remains the enforced gate.

Sequence for any future ad-hoc long-running branch:

1. Create branch.
2. CI workflow extension PR (mirror onto both `main` and the branch).
3. *Then* the first feature ticket.

### 7a. Wave branches — `wave-N-<slug>` naming convention

> **Rule:** When the work is a tightly-scoped multi-PR effort that will
> merge back to main as a unit (the typical "wave" pattern in this repo),
> name the branch `wave-N-<short-slug>` so `pr-tests.yml`'s `wave-*` glob
> trigger picks it up automatically — no workflow patch round-trip
> required.

**Why:** The previous version of this rule (§7) required a workflow-edit
PR before any wave work could start. The pattern fired correctly, but the
edit was identical every time except for the branch name, and it cost a
round-trip. Adding a `wave-*` glob to `pr-tests.yml` (PR #228) made the
naming convention sufficient on its own. Wave branches now JustWork
without per-wave plumbing; only ad-hoc one-off long-running branches
(things that won't fit `wave-N-<slug>`) still need §7's manual extension.

**How to apply:**

Naming pattern: `wave-N-<short-slug>` where:

- `N` is the wave number (matches the project board's "Wave" custom field
  — Wave 2 → `wave-2-...`, Wave 3 → `wave-3-...`).
- `<short-slug>` is a kebab-case description of the wave's theme. Pick
  the same shape used for issue titles: a few words, no punctuation
  beyond hyphens, no trailing slash.

Examples:

- `wave-2-audit-followups`
- `wave-3-edges-epic`
- `wave-4-search`

`pr-tests.yml` already triggers on `branches: [main, 'wave-*']`, so PRs
into any matching branch fire the full lint + security + compile +
integration suite automatically. No workflow patch needed.

Sequence for a new wave:

1. Create the wave branch off `main`: `git checkout -b wave-N-<slug>`.
2. Open feature PRs against the wave branch (`gh pr create --base wave-N-<slug>`).
   Existing in-flight PRs against main can be re-targeted with
   `gh pr edit <num> --base wave-N-<slug>`.
3. Run `weekend.yml` against the wave branch once the wave's PRs have all
   merged into it: `gh workflow run weekend.yml --ref wave-N-<slug>`.
   This is the integration-verification step that justifies the wave
   pattern in the first place.
4. Open the final merge PR `wave-N-<slug>` → `main` once weekend.yml is
   green.

If `weekend.yml` fails on the wave branch, fix on the wave branch (open
a new PR into it) and re-run; this is the whole point — main stays at
last-known-stable until the wave is integration-verified.

---

## Meta — keeping these conventions current

### 8. Doc is the master record; memory entries are thin replicas

> **Rule:** This document is the authoritative source for the working
> agreements. The agent's per-project memory entries (e.g.,
> `feedback_*.md` files under `~/.claude/projects/<project>/memory/` for
> Claude Code) are thin replicas — they exist so the agent's relevance
> matcher fires on the right rule, and their bodies just point back to
> the relevant section here.

**Why:** Two parallel sources of truth drift; one of them needs to win.
The doc is the better master because: (a) it's reviewable in PR diffs,
(b) it has structure (categories, cross-references, examples, the
porting guide) that loose memory files don't, and (c) it's what a new
collaborator or another project would actually consume. Memory's job is
narrower — it just needs the frontmatter + filename + description so the
relevance matcher can surface the right rule, then the agent reads this
doc for the actual content. Treating doc as master eliminates the
"did I update both?" discipline cost and removes the "which is right?"
ambiguity when a drift is discovered.

**How to apply:**

When adding / modifying / removing a rule:

1. **Edit this document** — both the **Quick reference** one-liner *and*
   the per-rule expanded section (Rule / Why / How to apply). Renumber
   later rules if inserting; remove the entry if deleting; update the
   "Adapting" section if portability semantics changed.
2. **Update the memory pointer** — write/edit/delete the corresponding
   `feedback_*.md` so its frontmatter (`name`, `description`) matches
   the doc, and the body points to the new doc section. For new rules,
   also add the pointer line to `MEMORY.md`.
3. **Commit the doc change.** The memory update happens locally — memory
   lives outside the repo and isn't part of any PR.

**Memory body shape (thin replica):**

```markdown
---
name: <human-readable rule name>
description: <one-line description used by relevance matcher>
type: feedback
---
See [docs/AI-COLLABORATION-CONVENTIONS.md](docs/AI-COLLABORATION-CONVENTIONS.md) §N for the full rule, why, and how to apply.
```

When the relevance matcher surfaces this entry, the agent reads the doc
section to get the actual rule content — one extra Read, negligible cost.

**Operational-cache exception:** A few rules carry project-specific
operational data that benefits from being in memory directly (no extra
read needed mid-task) — e.g., cached GraphQL IDs for the project board.
Those stay in the memory body alongside the pointer:

```markdown
---
name: ...
---
See [docs/AI-COLLABORATION-CONVENTIONS.md](docs/AI-COLLABORATION-CONVENTIONS.md) §N for the full rule.

**Project-specific operational cache** (kept here for fast reuse):
- Project ID: PVT_xxx
- Status field ID: PVTSSF_xxx
- Option IDs: Todo=..., In Progress=..., Done=...
```

The split rule: **rule content → doc; project-specific operational
caches → memory body.**

### 9. Refresh stale operational caches on failure (don't ask, don't retry blindly)

> **Rule:** When a cached operational value (e.g., a project board ID,
> a resource UUID, a known file path) is used in an operation and the
> operation fails with an error pattern consistent with cache staleness
> (404 / "not found" / "no such resource" against an ID that previously
> worked), re-derive the value from the live source, update the cache
> in the relevant memory file, then retry the operation. Don't blindly
> retry with the stale value, and don't ask the user — the operational
> cache is the agent's responsibility to maintain.

**Why:** Per §8 (doc as master), project-specific operational caches live in memory
bodies (not the doc) — they're local shortcuts that bypass repeated API
queries. They drift silently when the underlying resource changes (board
rename, workflow file moved, ID-bearing entity recreated). Without a
refresh-on-failure rule, the agent's options are: (a) retry blindly and
fail again, (b) ask the user "what's the new ID?", or (c) silently skip
the operation. All three are bad. A "stale → refresh → retry once"
pattern catches drift loudly, self-heals, and doesn't burn user attention.

**Why not refresh proactively at every task start?** Most tasks don't
touch the cached resource, so a proactive refresh is wasteful — both in
API calls and in conversation context. First-failure refresh is the
sweet spot: cheap when the cache is valid (the common case), self-healing
when it isn't.

**How to apply:**

When using a cached value in an operation:

1. Run the operation with the cached value.
2. If it fails with a staleness-suggesting error:
   - Re-derive from the live source (specific command depends on what
     type of value — see the table below).
   - Update the cached value in the relevant `feedback_*.md` memory file.
   - Retry the operation with the fresh value.
3. If the fresh-derived value also fails: escalate to the user (the
   problem isn't cache staleness).

**What counts as a staleness-pattern error:**

- 404 / "not found" against a known-cached ID.
- "Project not found" / "field not found" against a project-board operation.
- "No such file or directory" against a known-cached path.
- Permission errors that suggest the resource was recreated under
  different ownership.

**NOT** staleness-pattern errors (different handling needed):

- Rate limiting (429) — back off and retry.
- Network timeouts — retry, no cache change.
- Validation errors (400) — fix the input, no cache change.
- Auth-token expiry — re-auth, no cache change.

**Common cache types and their re-derive sources:**

| Cache | Re-derive command |
|---|---|
| Project board IDs (Project, field, option) | `gh api graphql` query (see §2 for shape) |
| GitHub repo metadata | `gh api repos/<owner>/<repo>` |
| File paths in the project | `find` / `Glob` |
| External service IDs (Slack channel, JIRA project, etc.) | each service's API |

### 10. Midpoint audits — every 10 PRs into a tracked branch

> **Rule:** Every 10 PRs that land into a tracked branch (`main` and any
> long-running phase branch), perform a doc+test audit of the
> divergence range and trigger `weekend.yml` against the branch HEAD.
> The agent runs this proactively when it notices the threshold is
> crossed, before opening the next ticket.

**Why:** §4b keeps each PR locally compliant on docs and tests, but
cross-cutting docs (README, REQUIREMENTS, DEVELOPER-GUIDE) and
integration-level coverage drift in aggregate. The closeout sweep on
`nodes-rebuild` (PR #178) had to rewrite five top-level docs and add a
missing E2E in a single PR because drift went uncaught for ~80 commits.
A 10-PR cadence catches the same drift in ~8 smaller chunks.

Audit cost scales with diff content — 10 typo fixes ≈ minutes; 10
controller PRs ≈ longer — so the rule self-throttles. The ~20-min
`weekend.yml` run fires unconditionally; the runtime cost is paid by
GitHub Actions, not the user, and best practices apply to `main`
regardless of whether a regression is "expected." Catching one
pre-merge is far cheaper than debugging it post-merge.

**How to apply:**

Each audited branch has a dedicated tracking issue — the rebuild
ticket for phase branches; for `main`, a permanent "Audit log: main"
issue. The agent counts PRs merged since the most recent audit
comment on that issue using:

```bash
git log --merges --grep="Merge pull request" <last-baseline-sha>..HEAD | wc -l
```

This project uses merge-commit merges exclusively (`git log --first-parent main`
shows one merge commit per landed PR), so the grep matches every PR.
If the project ever switches to squash-merging, replace with
`git log --first-parent <last-baseline>..HEAD | wc -l`.

At every 10 PRs:

1. **Doc audit** — per §4b-1, for each PR in the window, list user-facing
   docs that reference the changed area. Update README + REQUIREMENTS
   + relevant `flow-*.md` / `howto-*.md` for any drift. Cross-check
   the inventory tables in `docs/TESTING-*.md` against
   `git ls-files backend/tests frontend/tests` to catch stale rows.

2. **Test audit** — per §4b-2, for each new UI page or endpoint in the
   window, confirm a Playwright spec exercises the primary flow; add
   one if missing.

3. **Long test** — `gh workflow run weekend.yml --ref <branch>`.

4. **Bundle any deltas into one "midpoint audit" PR.** The long-test
   run is evidence, not a deliverable — don't block the PR on it.

When the audit completes, comment on the tracking issue:

- audit point: `NN PRs (since <last-sha>)`
- doc/test deltas: link to audit PR, or "none"
- long test: ✅ / ❌ + run URL

The next audit reads the most recent such comment to find its
counting baseline.

**Concurrent-agent races:** before starting an audit, scan the
tracking issue for an in-progress audit comment posted in the last
hour. If one exists, defer — the other agent will land it. The race
window is small in practice (single-user, mostly serial sessions),
and the worst case if the rule is skipped (two parallel `weekend.yml`
runs and a duplicate audit PR) is annoyance, not damage. A full
lease/TTL mechanism is overkill until this actually bites.

**Bootstrapping:** The same PR that lands this rule also files the
"Audit log: main" tracking issue and posts the first baseline comment
("audit point: 0 PRs (since `<HEAD>`)") so the next agent has a
counting anchor. For long-running branches that already exist, the
audit issue is the rebuild's existing tracking ticket; retroactive
baseline = the most recent `Merge main into <branch>` commit.

### 11. Burst mode — checklist for multi-PR autonomous sessions

> **Rule:** When opening multiple independent PRs autonomously in a
> single session ("burst mode"), follow the burst checklist below.
> Skip the rule when only one PR is in flight; the structure exists to
> defend against the failure modes that scale with concurrent PRs.

**Why:** Two bursts so far (PR #178 nodes-rebuild closeout sweep, PRs
#201–#206 Wave 3 + #168) have surfaced the same structural failure:
a small CI failure caught only when the user notices, not when the PR
opens. PR #191 saturated the rate-limit bucket and broke downstream
E2E. PR #203 added a new `Sign in with SSO` button that matched the
existing `name: /sign in/i` selector in two sibling specs. Both shipped
silently because the agent ran the new spec locally, saw it pass, and
moved on without checking whether sibling specs still passed — and
without checking the PR's CI after opening.

The same two bursts also surfaced patterns that *worked*: pre-burst
dep audit (caught a #162/#163 co-location near-miss), status updates
every ~3 PRs to a tracking issue, end-of-burst `weekend.yml` against
the trunk. Codifying both the checklist and the skip rule makes the
next burst repeatable.

**How to apply:**

**1. Pre-burst dep audit** (~5 min before starting). List every ticket
in the burst. Identify A-blocks-B relationships (e.g., #195 reuses
#164's modal — sequential). Drop the dependent ones from this burst
and let them wait for a follow-up; re-order the rest by shape so the
simplest land first as warm-ups. Both real bursts caught issues here:
nodes-rebuild adjusted scope mid-burst when the dep wasn't audited;
Wave 3 caught the #162/#163 co-location pre-burst and switched #162
to a separate route.

**2. Run the *whole* affected spec suite locally before each
`gh pr create`** — not just the new spec. UI changes to existing
surfaces frequently break sibling tests' selectors. The PR #203
failure mode would have been caught by:

```bash
# For LoginForm changes, run every spec that interacts with /login:
npx playwright test sso-initiate auth smoke
```

The agent's reflex is to run only the new spec ("test passed → done").
Sibling specs that select on shared element names (the canonical case:
`page.getByRole('button', { name: /sign in/i })`) silently break the
moment a new same-named element appears in the same surface. Identify
the affected specs by greping for the touched component name across
`tests/e2e/`, then run them together.

**3. Status updates every ~3 PRs to a tracking issue** (the audit-log
issue or burst-tracking issue). Caption: PR# / closes / type / one-
line note. Without this, the user has no visibility into mid-burst
state when they check in. The post-burst report at the end is fine
but doesn't help during the run.

**4. End-of-burst CI sweep** (mandatory). After the last PR opens:

```bash
for pr in <list of burst PR numbers>; do
  echo "=== PR #$pr ==="
  gh pr checks $pr
done
```

Wait for `integration` jobs to finish (each takes ~3–5 min). Triage
failures: if multiple PRs fail with the same root cause (env, race,
shared selector regression), fix once; if isolated, fix individually.
Both bursts have had exactly one CI failure surface at this step
(#191 last burst, #203 this burst). Skipping the sweep means the user
has to do this triage when they return.

**5. End-of-burst `weekend.yml` against the trunk:**

```bash
gh workflow run weekend.yml --ref main
```

Catches integration regressions the per-PR cached CI might miss
(no-cache rebuild, extended tier including 5-minute soak, full E2E).
Watch in the background; post the run URL as a follow-up comment on
the burst-tracking issue when it lands.

**6. Skip-rather-than-guess on mid-burst scope ambiguity.** If a
ticket turns up scope ambiguity mid-implementation (UX call, design
question, missing requirement), file a question on the issue and
skip rather than guess. The user has explicitly opted in to this
mode multiple times — preserve their right to make UX calls
themselves.

**Optional: per-PR fast-check** (~60s after `gh pr create`).
`gh pr checks NN` reads the fast-running checks (lint / security /
compile, all under ~3 min) before they finish. If those fail, the
fix is mechanical (typo, missing import) and best done while the
PR's context is still fresh. Skippable on doc-only bursts.

**When NOT to use burst mode:**

- Tickets with judgment-heavy UX decisions ("what should this modal
  look like?") — interactive sessions handle this better.
- Tickets with sequential dependencies — one of them blocks the
  others, defeating the parallel-PR benefit.
- Tickets that need user input mid-implementation (design clarification,
  scope confirmation). The skip rule covers small instances; large
  instances should not be in the burst at all.

**Burst sizing rule of thumb:** ~25–30 min of focused work per PR;
~6–10 PRs per burst before context pressure forces shortcuts (the last
nodes-rebuild burst hit context pressure at the 6th PR, #175
conventions reorg).

---

## Adapting these conventions to other projects

When porting to another project:

- **Rule 1 (ticket sizing), §4a (Files changed), §4b (docs+tests), §4c
  (Test expectations)** are fully tooling-agnostic — the rule statements
  transfer directly.
- **§4d (Work breakdown)** transfers as a concept; the specific name of
  the task-tracker tool (`TodoWrite` here) is Claude Code-specific. For
  other agents, swap in the equivalent tracker name.
- **§4e (Operational impact)** transfers as a concept; the specific
  rebuild/restart commands assume Docker Compose. Substitute your stack's
  equivalents.
- **Rule 8 (doc as master)** transfers as a concept, but the specific
  memory-file format (`feedback_*.md` with frontmatter) is Claude Code-
  specific. For other agents, adapt the "thin replica" pointer shape to
  whatever per-rule storage that agent uses.
- **Rule 2 (status lifecycle)** carries a project-board GraphQL ID block in
  **How to apply** that needs replacement with the new project's IDs.
- **Rule 3 (default project)** has the project number / owner hardcoded —
  swap for your project's equivalents.
- **Rule 5 (Co-Authored-By trailer)** assumes Claude; for other agents
  (Cursor, Aider, etc.) adjust the trailer format to match what the agent
  actually identifies as.
- **Rule 6 (public-repo scan)** only applies if the repo is public. Skip it
  for private repos, but consider keeping the secrets-scan portion anyway —
  leaked credentials in private-repo history are still a risk if the repo's
  visibility ever changes.
- **Rule 7 (long-running branch CI)** assumes GitHub Actions; adapt the
  "extend the workflow" mechanics for other CI systems (GitLab CI, Buildkite,
  etc.).
- **Rule 9 (refresh stale caches)** transfers as a concept; the specific
  re-derive commands depend on what type of cache value is at stake (project
  board IDs, file paths, external service IDs, etc.).
- **Rule 10 (midpoint audits)** assumes GitHub Actions (`weekend.yml` via
  `gh workflow run`) and the merge-commit counting recipe assumes
  merge-commit merges. Adapt the workflow trigger and counting recipe to
  the target project's CI system and merge style. The cadence (every 10
  PRs) and the tracking-issue mechanic transfer directly.
- **Rule 11 (burst mode)** uses GitHub-CLI commands (`gh pr checks`,
  `gh workflow run weekend.yml`) but the cadence transfers directly:
  the dep-audit, run-the-whole-affected-suite-locally, status-update-
  every-3, end-of-burst CI sweep, and skip-rather-than-guess rules
  are all CI-system-agnostic. Substitute the project's equivalents
  for `gh pr checks` (e.g., `glab pipeline view`) and the long-test
  workflow.
