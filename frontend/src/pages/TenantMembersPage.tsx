import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { tenantsService } from '@/services/maps';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/utils/errors';
import type { TenantMember } from '@/types';

// Tenant-member management (#162). Lists current members, lets admins add
// new ones (by userId — username/email-based picker is a natural follow-up
// and is filed separately) and remove existing ones.
//
// Self-protection: admins cannot remove themselves if they're the last
// admin in the tenant — the UI hides the "Remove" action on their own
// row in that case (the backend would also reject, but the UI guard
// prevents the wasted submission).
//
// Auth-gated by role; non-admins see an "access denied" banner.

const ROLES = ['admin', 'editor', 'viewer'] as const;
type Role = typeof ROLES[number];

export function TenantMembersPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const tenantIdNum = Number(tenantId);

  const role = useAuthStore((s) =>
    s.tenants.find((t) => t.id === tenantIdNum)?.role,
  );
  const callerUserId = useAuthStore((s) => s.user?.id);
  const isAdmin = role === 'admin';

  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const fresh = await tenantsService.listMembers(tenantIdNum);
      setMembers(fresh);
      setError(null);
    } catch (e) {
      setError(extractApiError(e, 'Failed to load tenant members.'));
    }
  };

  useEffect(() => {
    if (!tenantIdNum || !isAdmin) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    tenantsService.listMembers(tenantIdNum)
      .then((m) => { if (!cancelled) setMembers(m); })
      .catch((e) => { if (!cancelled) setError(extractApiError(e, 'Failed to load tenant members.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantIdNum, isAdmin]);

  if (!tenantIdNum) {
    return <div className="page-error">Missing tenant in route.</div>;
  }
  if (!isAdmin) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Tenant members</h1>
          <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
            ← Back to maps
          </Link>
        </div>
        <div className="alert alert-error">
          Only tenant admins can manage members.
        </div>
      </div>
    );
  }
  if (loading) return <div className="page-loading">Loading members…</div>;

  const adminCount = members.filter((m) => m.role === 'admin').length;

  const handleRemove = async (m: TenantMember) => {
    const isSelf = m.userId === callerUserId;
    const isLastAdmin = m.role === 'admin' && adminCount === 1;
    if (isLastAdmin) {
      window.alert('Cannot remove the last admin — promote another admin first.');
      return;
    }
    const confirmMsg = isSelf
      ? 'Remove yourself from this tenant? You will lose access.'
      : `Remove ${m.username} from this tenant?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await tenantsService.removeMember(tenantIdNum, m.userId);
      await reload();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to remove member.'));
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Tenant members</h1>
        <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
          ← Back to maps
        </Link>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="tenant-admin-section">
        <h2>Current members ({members.length})</h2>
        {members.length === 0 ? (
          <p className="empty-state">No members yet.</p>
        ) : (
          <ul className="member-list">
            {members.map((m) => {
              const isSelf = m.userId === callerUserId;
              const isLastAdmin = m.role === 'admin' && adminCount === 1;
              return (
                <li key={m.userId} className="member-row">
                  <span className="member-name">
                    {m.username}{isSelf && ' (you)'}
                  </span>
                  <span className="member-email">{m.email}</span>
                  <span className={`member-role member-role-${m.role}`}>{m.role}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRemove(m)}
                    disabled={isLastAdmin}
                    title={isLastAdmin ? 'Cannot remove the last admin' : undefined}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AddMemberSection tenantId={tenantIdNum} onAdded={reload} />
    </div>
  );
}

// ─── Add-member form ─────────────────────────────────────────────────────────

function AddMemberSection({
  tenantId,
  onAdded,
}: { tenantId: number; onAdded: () => Promise<void> | void }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const idNum = Number(userId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      setError('User ID must be a positive integer.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await tenantsService.addMember(tenantId, idNum, role);
      setUserId('');
      setRole('viewer');
      await onAdded();
    } catch (e) {
      setError(extractApiError(e, 'Failed to add member.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="tenant-admin-section">
      <h2>Add member</h2>
      <form className="tenant-admin-form" onSubmit={handleSubmit}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <label htmlFor="add-userid">User ID</label>
          <input
            id="add-userid"
            inputMode="numeric"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="42"
            required
          />
          {/* The backend addMember endpoint takes a numeric user id; the
              email-or-username picker is intentionally a follow-up
              (would need a backend user-lookup endpoint that doesn't
              exist yet). */}
          <small className="form-hint">
            The user must already have an account in the same organization.
            Username/email-based lookup is a planned follow-up.
          </small>
        </div>
        <div className="form-group">
          <label htmlFor="add-role">Role</label>
          <select
            id="add-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="tenant-admin-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </form>
    </section>
  );
}
