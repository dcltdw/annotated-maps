# Security Audit — Nodes-Rebuild Cycle (2026-05-06)

Companion to [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) and the previous
[`SECURITY-AUDIT-2026-04-NOTES.md`](SECURITY-AUDIT-2026-04-NOTES.md).
This audit was tracked under issue
[#46](https://github.com/dcltdw/annotated-maps/issues/46).

## Why this audit happened

The nodes-rebuild branch landed substantial new surface area:

- Recursive-CTE effective-visibility model with `owner_xray` bypass
  (NodeController, NoteController, PlotController)
- Cross-tenant move/copy operations (NodeController moveNode/copyNode)
- "Visibility group manager" auth helper and `manages_visibility`
  group flag with escalation guards (VisibilityAuth.h)
- New tenant-administration UI surfaces (TenantAdminPage,
  TenantMembersPage, MapSharingModal)
- POST/PUT full-record refactor (#152) — write endpoints re-SELECT and
  return the canonical row shape

Each of these introduces an authorization or data-integrity question
that the existing audits did not cover.

## Methodology

Single-pass focused audit with axes scoped to the new surface area:

1. **Visibility model** — recursive CTE bounds, override/inherit
   semantics, owner_xray bypass safety
2. **Cross-tenant authorization** — does every multi-tenant operation
   enforce caller membership in *both* source and destination tenants?
3. **Manager-flag escalation** — can a non-admin promote themselves to
   visibility-group manager? Can the bootstrap group be deleted to
   lock out tenant administration?
4. **Move/copy atomicity** — multi-statement operations under
   concurrent access and partial-failure conditions
5. **Coordinate-system validation** — pixel/blank/wgs84 input shapes
6. **Plots** — plot-membership endpoints and map-permission gating
7. **Bonus axes** — admin-surface UI authorization, POST/PUT refactor
   tenant-scope check on the SELECT-after-write shape

For each axis I read the relevant controller code (`grep` for the
endpoint, then `Read` for the full handler) and traced the
authorization gate from filter (JwtFilter, TenantFilter) through the
controller body to the SQL parameter binding.

## Findings summary

| ID | Severity | Area | Status |
|----|----------|------|--------|
| H1 | High | Atomicity | Filed as follow-up |
| M1 | Medium | Plots | Filed as follow-up |
| M2 | Medium | Tenant members | Filed as follow-up |
| L1 | Low | Validation | Documented inline |
| L2 | Low | DOS surface | Documented inline |
| L3 | Low | Operations | Documented inline |

No Critical findings. All four `#46`-scoped axes plus the two bonus
axes were checked.

---

## H1 — Multi-step DB operations are not transaction-wrapped

**Severity:** High
**Area:** Move/copy atomicity, visibility writes, registration
**Files:**
- [`backend/src/controllers/NodeController.cpp:1220`](../backend/src/controllers/NodeController.cpp#L1220) (moveNode)
- [`backend/src/controllers/NodeController.cpp:1600`](../backend/src/controllers/NodeController.cpp#L1600) (copyNode)
- [`backend/src/controllers/NodeController.cpp:746`](../backend/src/controllers/NodeController.cpp#L746) (setVisibility)
- [`backend/src/controllers/AuthController.cpp`](../backend/src/controllers/AuthController.cpp) (register)

**Reproduction:**

`grep -nE "newTransaction|beginTransaction" backend/src/controllers/`
returns no matches. Multi-statement operations therefore rely on
each `execSqlAsync` call independently; if any intermediate step
fails (DB hiccup, connection pool exhaustion, MySQL kill), the
operation leaves partially-applied state and returns an error to the
caller.

Concrete vulnerable sequences:

- **moveNode cross-map** (4 chained operations) — re-parent the node,
  re-stamp `map_id` on the moved subtree, recompute paths, audit. A
  failure between steps 2 and 3 leaves descendants on the old map
  while the root points to the new one.
- **copyNode** — descendant insert loop + note copy loop + plot reset.
  A failure mid-loop leaves an orphaned partial subtree under the new
  parent.
- **setVisibility** — truncate `node_visibility`/`note_visibility`
  rows for the target, then re-insert from the request body. A
  failure between truncate and re-insert removes all visibility tags
  without replacement, exposing the node/note to everyone in the
  tenant until the user retries.
- **register** — 7-step flow (insert org → insert tenant → insert
  user → insert tenant_members → insert visibility_groups bootstrap
  → insert visibility_group_members → audit). A failure mid-flow
  leaves an account in an unusable inconsistent state (e.g., user
  exists but no tenant membership row).

**Recommended fix:** Use Drogon's transaction API
(`db->newTransactionAsync`) to wrap each multi-step operation. The
async-callback chain is verbose; consider a small helper that
sequences a vector of `std::function<void(Transaction&, …)>` steps
and rolls back on the first failure.

**Why High:** silent partial state corrupts authorization-relevant
data (visibility tags, parent_id, map_id). The setVisibility case is
the worst — it briefly *removes* a security control. Probability is
low (DB hiccups are rare) but blast radius per occurrence is real.

**Tracking:** filed as follow-up ticket.

---

## M1 — PlotController::listMembers does not check map_permissions

**Severity:** Medium
**Area:** Plots
**File:** [`backend/src/controllers/PlotController.cpp:471`](../backend/src/controllers/PlotController.cpp#L471)

**Reproduction:**

The handler joins plot members to `maps` only to verify tenant scope
(`m.tenant_id = ?`) and applies the visibility-group CTE for non-admin
filtering. It does **not** join `map_permissions` to verify the caller
has access to the underlying map.

Compare with the regular node-list path
([`NodeController.cpp:127-129`](../backend/src/controllers/NodeController.cpp#L127-L129))
which gates with
`(m.owner_id = ? OR mp.level IN (...) OR mp_pub.level IN (...))`.

Concrete attack: tenant viewer Alice has no `map_permissions` row on
private map M owned by Bob. Bob adds nodes from M to a tenant-scoped
plot P. Alice GETs `/tenants/{tid}/plots/{P}/members` and sees node
metadata (id, map_id, name, color, visibility_override) for nodes
from M she could not see via `/tenants/{tid}/maps/{M}/nodes`.

**Recommended fix:** add the same map-permission JOIN/predicate that
listNodes uses to both the node and note SQL branches in listMembers.
Add a regression test alongside `test_22_plots.py`.

**Why Medium:** information disclosure (node names, structure) but
not modification. The visibility-group CTE still filters out
explicitly-tagged nodes, so the leak is limited to nodes whose
visibility is "default" (no tags). Still a clear gap because the
documented model is "two layers stack" (per-map permissions *then*
visibility groups) and this endpoint skips layer one.

**Tracking:** filed as follow-up ticket.

---

## M2 — Admin can self-demote and orphan a tenant

**Severity:** Medium
**Area:** Tenant members
**File:** [`backend/src/controllers/TenantController.cpp:239`](../backend/src/controllers/TenantController.cpp#L239) (addMember)

**Reproduction:**

`addMember` uses `INSERT … ON DUPLICATE KEY UPDATE role=VALUES(role)`,
and the only authorization gate is `callerRole == "admin"`. There is
no guard preventing the caller from targeting their own `userId`.

A tenant admin can therefore POST
`{userId: <self>, role: 'viewer'}` and demote themselves. If they were
the only admin, the tenant is left with zero administrators. Because
there is no separate role-change endpoint and `removeMember` blocks
self-removal, no API-only path exists to recover; the tenant must be
fixed via direct DB intervention.

`removeMember` correctly blocks `callerId == userId`; `addMember`
inherits no such guard because it is conceptually "add", not "edit".

**Recommended fix:** in `addMember`, when `targetUserId == callerId`
and the new role is not `admin`, count current admins and reject if
the caller is the last one. Same shape as the proposed last-admin
guard in the frontend `TenantMembersPage`. Also consider rejecting
self-targeted writes outright (`addMember` is for *adding others*;
self-modification should go through a separate role-change endpoint
when one is added).

**Why Medium:** account self-lockout is recoverable only out-of-band.
Probability of accidental trigger is low (admin would have to
deliberately reduce their own role) but the failure mode is severe
and irreversible from the API. Catching it is cheap.

**Tracking:** filed as follow-up ticket.

---

## L1 — `removePermission` uses unguarded `std::stoi` on path param

**Severity:** Low
**Area:** Validation
**File:** [`backend/src/controllers/MapController.cpp:714`](../backend/src/controllers/MapController.cpp#L714)

`int targetId = std::stoi(target);` runs after the `target == "public"`
branch. If a caller sends a path like
`DELETE /tenants/.../permissions/abc`, `std::stoi` throws
`std::invalid_argument`. Drogon catches handler exceptions and
returns 500, so the user sees a server error instead of 400.

**Recommended fix:** parse with `std::from_chars` or wrap in
try/catch and return 400 with a clear `bad_request` error. Pattern is
already used elsewhere in the codebase. Documented inline; not worth
a follow-up ticket on its own.

---

## L2 — Per-map node count is uncapped

**Severity:** Low
**Area:** DOS surface

There is no per-map cap on node count. A malicious editor could
create unbounded children under a single root, slowing
`listNodes`/`getSubtree` for everyone with map access.

Bounded by the existing per-tenant 1000-map cap: a single tenant
cannot fan out arbitrarily across maps. But a single map could
become a hot spot. Worth reconsidering if perf metrics surface a
slow-map outlier in production.

**Recommended fix:** add a `MAX_NODES_PER_MAP` constant and check
in `createNode` after counting. Documented inline.

---

## L3 — SSO-provisioned tenants need bootstrap visibility group

**Severity:** Low
**Area:** Operations

`AuthController::register` seeds a "Visibility Managers"
visibility-group with `manages_visibility = TRUE` for the new
tenant. SSO authentication goes through `SsoController`, which
*does not provision new tenants* — it looks up an existing
`(org, tenant)` and inserts only the `tenant_members` row. Therefore
SSO itself is not the gap.

The actual operational risk: organizations whose tenants are
provisioned out-of-band (DB seed, admin tool, future SSO-org-bootstrap
endpoint) will not have the bootstrap group. Tenant admins still
authenticate (`isTenantAdmin` allows them through `requireVisibilityGroupManager`),
but no other user can be granted manager status until an admin
manually creates the group.

**Recommended fix:** document in `docs/SETUP-LOCAL-DEV.md` (or the
forthcoming SSO setup guide) that new tenants must have a row in
`visibility_groups` with `manages_visibility = TRUE`. Optionally,
extract the bootstrap SQL from `AuthController::register` into a
helper that any tenant-provisioning path can call.

---

## Carry-forward

The earlier audit's L1 (no lat/lng range check on WGS84 coordinate
system input in `MapController::validateCoordinateSystem`) is
unchanged in the post-rebuild code
([`MapController.cpp:25-79`](../backend/src/controllers/MapController.cpp#L25-L79)).
Re-confirmed open; tracked under that audit's follow-ups.

## What was checked and found clean

- **Visibility CTE bound:** `MAX_NODE_DEPTH=15` caps recursion; the
  CTE is parameterized with both `userId` and the starting node set.
- **owner_xray gating:** `(m.owner_id = ? AND m.owner_xray = TRUE)`
  pattern is consistent across NodeController, NoteController,
  PlotController. Always tied to the *map's* owner, never the caller.
- **Cross-tenant move/copy:** moveNode/copyNode require admin role
  in both source and destination tenants when the destination is
  cross-tenant. Same-tenant moves require editor in that tenant.
- **Manager-flag escalation:** `createGroup` and `updateGroup` both
  guard with `if (managesVisibility && !isTenantAdmin(req))`. Only
  tenant admins can create or set the `manages_visibility = TRUE`
  flag. Bootstrap-group deletion does not lock out admins because
  `isTenantAdmin` is a synchronous check independent of group
  membership.
- **Cross-tenant data references in plots:** `addNode`/`addNote`
  validate that both the plot *and* the target node/note belong to
  the URL's tenant (via JOIN to `maps.tenant_id`).
- **setVisibility cross-tenant group reference:** validates that
  every `groupId` in the request body belongs to the URL's tenant
  before truncate/insert.
- **Coordinate-system input validation:** strong type discrimination
  (wgs84/pixel/blank), pixel `image_url` restricted to http/https.
- **Branding update:** colors validated as `#RGB`/`#RRGGBB`/`#RRGGBBAA`,
  URLs restricted to https://, display_name length-capped to 255.
- **Tenant member add cross-org:** verifies the target user is in the
  same `org_id` as the tenant before INSERT.
- **MapSharingModal:** UI does no authorization of its own and relies
  entirely on `setPermission`/`removePermission`'s owner-only check.
  Correct: backend is the source of truth.
- **POST/PUT full-record refactor (#152):** every re-SELECT after
  INSERT/UPDATE filters by `id = ? AND tenant_id = ?`, preserving
  tenant scope on the response shape.
- **TenantAdminPage / TenantMembersPage:** UI role gates are belt
  and suspenders; backend `updateBranding`, `listMembers`,
  `addMember`, `removeMember` all check `tenantRole == "admin"`.
