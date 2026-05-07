import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { visibilityGroupsService, tenantsService } from '@/services/maps';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/utils/errors';
import type {
  VisibilityGroup,
  VisibilityGroupMember,
  CreateVisibilityGroupRequest,
  UpdateVisibilityGroupRequest,
  TenantMember,
} from '@/types';

// Phase 2g.g (#94): Visibility-group admin page. CRUD on groups +
// add/remove members. Per-node/per-note tagging UI is in #105 (94.b);
// visual indicators on the tree + owner_xray banner + E2E in #106 (94.c).
//
// Server-enforced auth (from #98): tenant admin OR member of any group
// with manages_visibility=TRUE in the same tenant. Setting
// managesVisibility=true on POST/PUT is admin-only — managers can't
// bootstrap themselves into more power. The UI hides the
// managesVisibility checkbox for non-admins; the backend rejects with
// 403 if it ever leaks through.

export function VisibilityGroupsPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const tenantIdNum = Number(tenantId);

  // Tenant-admin status drives the managesVisibility checkbox visibility.
  // For non-admins, manager status is implied by getting 200 from the API
  // — if the backend lets them list, they're allowed to manage too.
  const currentTenant = useAuthStore((s) =>
    s.tenants.find((t) => t.id === tenantIdNum),
  );
  const isAdmin = currentTenant?.role === 'admin';

  const [groups, setGroups] = useState<VisibilityGroup[]>([]);
  const [tenantMembers, setTenantMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state for create / edit.
  const [editingGroup, setEditingGroup] = useState<VisibilityGroup | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reloadGroups = async () => {
    try {
      const fresh = await visibilityGroupsService.listGroups(tenantIdNum);
      setGroups(fresh);
      setAccessDenied(false);
    } catch (e: unknown) {
      const msg = extractApiError(e, 'Failed to load visibility groups.');
      // Crude 403 detection — extractApiError returns the server message
      // verbatim and we look for the standard "Only tenant admins or
      // visibility-group managers" copy from the backend.
      if (/forbid|admin|manager/i.test(msg)) {
        setAccessDenied(true);
      } else {
        setError(msg);
      }
    }
  };

  useEffect(() => {
    if (!tenantIdNum) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAccessDenied(false);

    Promise.all([
      reloadGroups(),
      // Tenant members feed the "add to group" dropdown. If the caller
      // can't list (non-admin), an empty list just disables the form.
      tenantsService
        .listMembers(tenantIdNum)
        .then((m) => { if (!cancelled) setTenantMembers(m); })
        .catch(() => { if (!cancelled) setTenantMembers([]); }),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
    // reloadGroups is intentionally stable in this effect — only re-run when tenant changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantIdNum]);

  if (!tenantIdNum) {
    return <div className="page-error">Missing tenant in route.</div>;
  }
  if (loading) return <div className="page-loading">Loading visibility groups…</div>;
  if (accessDenied) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Visibility Groups</h1>
          <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
            ← Back to maps
          </Link>
        </div>
        <div className="alert alert-error">
          Only tenant admins or members of a visibility-group manager
          can access this page.
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Visibility Groups</h1>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New Group
          </button>
          <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
            ← Back to maps
          </Link>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {groups.length === 0 ? (
        <div className="empty-state">
          <p>No visibility groups yet.</p>
        </div>
      ) : (
        <ul className="visibility-group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <VisibilityGroupRow
                group={g}
                tenantId={tenantIdNum}
                tenantMembers={tenantMembers}
                isAdmin={isAdmin}
                onEdit={() => setEditingGroup(g)}
                onChange={reloadGroups}
              />
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <GroupFormModal
          mode="create"
          tenantId={tenantIdNum}
          isAdmin={isAdmin}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await reloadGroups();
          }}
        />
      )}
      {editingGroup && (
        <GroupFormModal
          mode="edit"
          tenantId={tenantIdNum}
          isAdmin={isAdmin}
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSaved={async () => {
            setEditingGroup(null);
            await reloadGroups();
          }}
        />
      )}
    </div>
  );
}

// ─── Per-group row (collapsible, with members list inside) ───────────────────

interface VisibilityGroupRowProps {
  group: VisibilityGroup;
  tenantId: number;
  tenantMembers: TenantMember[];
  isAdmin: boolean;
  onEdit: () => void;
  onChange: () => Promise<void> | void;
}

function VisibilityGroupRow({
  group,
  tenantId,
  tenantMembers,
  isAdmin,
  onEdit,
  onChange,
}: VisibilityGroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<VisibilityGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const reloadMembers = async () => {
    setLoadingMembers(true);
    setMemberError(null);
    try {
      const fresh = await visibilityGroupsService.listMembers(group.id, tenantId);
      setMembers(fresh);
    } catch (e) {
      setMemberError(extractApiError(e, 'Failed to load group members.'));
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleToggle = async () => {
    if (!expanded && members.length === 0 && !loadingMembers) {
      await reloadMembers();
    }
    setExpanded((e) => !e);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete visibility group "${group.name}"?`)) return;
    try {
      await visibilityGroupsService.deleteGroup(group.id, tenantId);
      await onChange();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to delete group.'));
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!window.confirm('Remove this member from the group?')) return;
    try {
      await visibilityGroupsService.removeMember(group.id, userId, tenantId);
      await reloadMembers();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to remove member.'));
    }
  };

  return (
    <article className="visibility-group-row">
      <header className="visibility-group-header" onClick={handleToggle}>
        <button
          type="button"
          className="visibility-group-toggle"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <h2 className="visibility-group-name">{group.name}</h2>
        {group.managesVisibility && (
          <span className="visibility-group-badge" title="Members of this group can manage visibility groups in this tenant">
            🔑 manages visibility
          </span>
        )}
        {expanded && (
          <span className="visibility-group-count">
            {loadingMembers ? '…' : `${members.length} member${members.length === 1 ? '' : 's'}`}
          </span>
        )}
        <div className="visibility-group-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          >
            Delete
          </button>
        </div>
      </header>
      {group.description && (
        <p className="visibility-group-description">{group.description}</p>
      )}
      {expanded && (
        <div className="visibility-group-body">
          {memberError && <div className="alert alert-error">{memberError}</div>}
          {members.length === 0 && !loadingMembers && (
            <p className="visibility-group-empty">No members yet.</p>
          )}
          {members.length > 0 && (
            <ul className="visibility-member-list">
              {members.map((m) => (
                <li key={m.userId} className="visibility-member-row">
                  <span className="visibility-member-name">{m.username}</span>
                  <span className="visibility-member-email">{m.email}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRemoveMember(m.userId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <AddMemberForm
            groupId={group.id}
            tenantId={tenantId}
            tenantMembers={tenantMembers}
            currentMemberIds={new Set(members.map((m) => m.userId))}
            onAdded={reloadMembers}
          />
          {/* `isAdmin` isn't needed for this row's render because the per-row
              affordances (delete group, add/remove member) are server-gated
              identically for admin + manager. The `isAdmin` prop is still
              threaded through in case a future ticket wants to differentiate
              UI by role. */}
          {isAdmin /* future-proofing */ && null}
        </div>
      )}
    </article>
  );
}

// ─── Add-member form ─────────────────────────────────────────────────────────

interface AddMemberFormProps {
  groupId: number;
  tenantId: number;
  tenantMembers: TenantMember[];
  currentMemberIds: Set<number>;
  onAdded: () => Promise<void> | void;
}

function AddMemberForm({
  groupId,
  tenantId,
  tenantMembers,
  currentMemberIds,
  onAdded,
}: AddMemberFormProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligible candidates: tenant members not already in the group.
  // (Backend's same-org check from #98 still applies on the server side
  // — if the user list contains anyone cross-org, the add will 400.)
  const candidates = useMemo(
    () => tenantMembers.filter((m) => !currentMemberIds.has(m.userId)),
    [tenantMembers, currentMemberIds],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setError(null);
    setSaving(true);
    try {
      await visibilityGroupsService.addMember(
        groupId,
        Number(selectedUserId),
        tenantId,
      );
      setSelectedUserId('');
      await onAdded();
    } catch (e) {
      setError(extractApiError(e, 'Failed to add member.'));
    } finally {
      setSaving(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <p className="visibility-group-empty">
        All tenant members are already in this group.
      </p>
    );
  }

  return (
    <form className="visibility-add-member-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error">{error}</div>}
      <select
        value={selectedUserId}
        onChange={(e) => setSelectedUserId(e.target.value)}
        disabled={saving}
      >
        <option value="">Choose a tenant member…</option>
        {candidates.map((m) => (
          <option key={m.userId} value={String(m.userId)}>
            {m.username} ({m.email})
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={saving || !selectedUserId}
      >
        {saving ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

// ─── Create / edit modal ─────────────────────────────────────────────────────

interface GroupFormModalProps {
  mode: 'create' | 'edit';
  tenantId: number;
  isAdmin: boolean;
  group?: VisibilityGroup;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function GroupFormModal({
  mode,
  tenantId,
  isAdmin,
  group,
  onClose,
  onSaved,
}: GroupFormModalProps) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [managesVisibility, setManagesVisibility] = useState(group?.managesVisibility ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === 'create') {
        const req: CreateVisibilityGroupRequest = { name };
        if (description) req.description = description;
        if (isAdmin) req.managesVisibility = managesVisibility;
        await visibilityGroupsService.createGroup(req, tenantId);
      } else if (group) {
        const req: UpdateVisibilityGroupRequest = {};
        if (name !== group.name) req.name = name;
        if (description !== group.description) req.description = description;
        if (isAdmin && managesVisibility !== group.managesVisibility) {
          req.managesVisibility = managesVisibility;
        }
        await visibilityGroupsService.updateGroup(group.id, req, tenantId);
      }
      await onSaved();
    } catch (e) {
      setError(extractApiError(e, `Failed to ${mode} group.`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'create' ? 'New Visibility Group' : 'Edit Visibility Group'}</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="vg-name">Name</label>
            <input
              id="vg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Players, GMs, …"
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="vg-description">Description</label>
            <textarea
              id="vg-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
              disabled={saving}
            />
          </div>
          {isAdmin && (
            <div className="form-group form-group-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={managesVisibility}
                  onChange={(e) => setManagesVisibility(e.target.checked)}
                  disabled={saving}
                />
                Members of this group can manage visibility groups
                <small>
                  Tenant admins always have this power. Granting it via a
                  group lets non-admin users CRUD visibility groups on
                  this tenant.
                </small>
              </label>
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !name}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
