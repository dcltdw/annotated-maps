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
4. **Every PR body has a `## Files changed` section** — alphabetical list of
   files with one-line summaries.
5. **Update docs and tests alongside code in every PR.** Verify both
   explicitly; if neither needs updating, say so in the PR description.
6. **Include a `## Test expectations` table only when some CI checks are
   expected to fail.** Skip the section entirely when everything is green.
7. **Capture the agent's task-tracker breakdown in a `## Work breakdown`
   section of the PR body** so the work sequence is durable next to the
   diff.
8. **Stamp commits with the current AI model name** (not a previously-used
   string) in the `Co-Authored-By:` trailer.
9. **Scan the actual diff for secrets, PII, and internal references before
   opening every PR** in a public repository.
10. **For long-running branches, extending the CI workflow to trigger on
    the branch is action #1**, before any feature ticket starts.
11. **This document is the master record; agent-memory entries are thin
    replicas pointing back here.** When a rule changes, edit the doc; the
    memory pointer's frontmatter is updated to match.
12. **When a cached operational value fails with a staleness-pattern error
    (404 / "not found" / "no such resource"), re-derive from the live
    source and update the cache before retrying.** Don't blindly retry,
    don't ask the user — refresh on first failure, escalate only if the
    fresh value also fails.

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

**Always verify after a board edit.** `gh project item-edit` can
silently no-op: exit code 0, no output, no actual change. Encountered
during the #106 cleanup — the first flip command returned cleanly but
the status stayed at In Progress; only spotted when the user noticed
the board was wrong on the next turn. The fix is cheap: every board
edit should be paired with an immediate read-back. Either chain them
in one shell command (`gh project item-edit ... ; gh project item-list
... --jq '.items[] | select(.content.number == NNN) | .status'`) or
run a follow-up read tool call. The board's eventual-consistency
window is short — a synchronous check in the same turn is sufficient.
Don't mark the corresponding TodoWrite item completed until the
read-back returns the expected status.

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
\`main\`/\`nodes-rebuild\` already if the PR merged). Skip if the
branch is the current checkout — switch to \`main\` first. Skip the
shared long-running branches (\`main\`, \`nodes-rebuild\`).

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

These IDs were stable as of `nodes-rebuild`. If they ever drift (project
rename, etc.), re-derive via:

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

## PR conventions

### 4. PR body must include a "Files changed" section

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

### 5. Always update docs and tests with code

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

### 6. PR Test Expectations section (only when failures are expected)

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

**Example:**

```markdown
## Test expectations (CI on `nodes-rebuild`)

| Job | Expected | Why |
|---|---|---|
| `lint` | ✅ pass | No frontend changes. |
| `compile` | ✅ pass | New code compiles locally. |
| `integration` (backend) | ✅ pass | 9/9 suites pass locally. |
| `integration` (E2E) | ❌ expected fail | Frontend still references old API; rebuild lands in #92, #101, #102. |
```

### 7. Capture the agent's task-tracker breakdown in the PR body

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

**Example:**

```markdown
## Work breakdown

1. Read NoteController to understand current shape
2. Add tagging endpoints (GET/POST .../notes/{id}/visibility)
3. Build note effective-visibility CTE (note → node → parent chain)
4. Apply filter to listNotes + getNote with admin/xray bypass
5. Build backend
6. Add tagging + filtering integration tests
7. Run tests + iterate
8. Open PR into nodes-rebuild
```

### 8. Stamp commits with the current AI model name

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

---

## Repo-level practices

### 9. Public-repo diff scan before every PR

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

### 10. Long-running branches — extend CI as action #1

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

When asked to create a long-running branch, the *first* deliverable is a
tiny PR that extends the project's CI workflow (e.g., `.github/workflows/pr-tests.yml`)
to:

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

Sequence for any future long-running branch:

1. Create branch.
2. CI workflow extension PR (mirror onto both `main` and the branch).
3. *Then* the first feature ticket.

---

## Meta — keeping these conventions current

### 11. Doc is the master record; memory entries are thin replicas

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

### 12. Refresh stale operational caches on failure (don't ask, don't retry blindly)

> **Rule:** When a cached operational value (e.g., a project board ID,
> a resource UUID, a known file path) is used in an operation and the
> operation fails with an error pattern consistent with cache staleness
> (404 / "not found" / "no such resource" against an ID that previously
> worked), re-derive the value from the live source, update the cache
> in the relevant memory file, then retry the operation. Don't blindly
> retry with the stale value, and don't ask the user — the operational
> cache is the agent's responsibility to maintain.

**Why:** Per rule 11, project-specific operational caches live in memory
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

---

## Adapting these conventions to other projects

When porting to another project:

- **Rules 1, 4, 5, 6** are fully tooling-agnostic — the rule statements
  transfer directly.
- **Rule 7 (Work breakdown in PR body)** transfers as a concept; the
  specific name of the task-tracker tool (`TodoWrite` here) is Claude
  Code-specific. For other agents, swap in the equivalent tracker name.
- **Rule 11 (doc as master)** transfers as a concept, but the specific
  memory-file format (`feedback_*.md` with frontmatter) is Claude Code-
  specific. For other agents, adapt the "thin replica" pointer shape to
  whatever per-rule storage that agent uses.
- **Rule 2 (status lifecycle)** carries a project-board GraphQL ID block in
  **How to apply** that needs replacement with the new project's IDs.
- **Rule 3 (default project)** has the project number / owner hardcoded —
  swap for your project's equivalents.
- **Rule 8 (Co-Authored-By trailer)** assumes Claude; for other agents
  (Cursor, Aider, etc.) adjust the trailer format to match what the agent
  actually identifies as.
- **Rule 9 (public-repo scan)** only applies if the repo is public. Skip it
  for private repos, but consider keeping the secrets-scan portion anyway —
  leaked credentials in private-repo history are still a risk if the repo's
  visibility ever changes.
- **Rule 10 (long-running branch CI)** assumes GitHub Actions; adapt the
  "extend the workflow" mechanics for other CI systems (GitLab CI, Buildkite,
  etc.).
- **Rule 12 (refresh stale caches)** transfers as a concept; the specific
  re-derive commands depend on what type of cache value is at stake (project
  board IDs, file paths, external service IDs, etc.).
