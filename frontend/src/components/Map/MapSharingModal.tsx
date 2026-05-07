import { useEffect, useState } from 'react';
import { permissionsService, tenantsService } from '@/services/maps';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/utils/errors';
import type { MapPermission, PermissionLevel, TenantMember } from '@/types';

// Map sharing / permissions modal (#161). Map owner only — opens from
// the "Share" button on MapDetailPage. Lists current per-user grants
// plus the public-access row (userId === null), allows add / change-
// level / revoke for each, and exposes a separate public toggle.
//
// Backend's setPermission requires the target user to be in the same
// org as the caller; the user-pick dropdown filters tenant members not
// already granted to keep the choices valid.

const LEVELS: PermissionLevel[] = ['view', 'comment', 'edit', 'moderate', 'admin'];

interface Props {
  mapId: number;
  onClose: () => void;
}

export function MapSharingModal({ mapId, onClose }: Props) {
  const tenantId = useAuthStore((s) => s.tenantId);
  const [perms, setPerms] = useState<MapPermission[]>([]);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const fresh = await permissionsService.listPermissions(mapId);
      setPerms(fresh);
    } catch (e) {
      setError(extractApiError(e, 'Failed to load permissions.'));
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    // listPermissions: required for the modal; failure aborts.
    // listMembers: best-effort to populate the user dropdown — non-admins
    // get 403 from the backend, so we fall back to a numeric userId input
    // (the cross-org check still happens server-side on grant).
    Promise.all([
      permissionsService.listPermissions(mapId),
      tenantsService.listMembers(tenantId).catch(() => [] as TenantMember[]),
    ])
      .then(([pp, mm]) => {
        if (cancelled) return;
        setPerms(pp);
        setMembers(mm);
      })
      .catch((e) => { if (!cancelled) setError(extractApiError(e, 'Failed to load permissions.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mapId, tenantId]);

  const publicPerm = perms.find((p) => p.userId === null) ?? null;
  const userPerms = perms.filter((p) => p.userId !== null);

  const handleSetLevel = async (userId: number | null, level: PermissionLevel) => {
    setError(null);
    try {
      await permissionsService.setPermission(mapId, { userId, level });
      await reload();
    } catch (e) {
      setError(extractApiError(e, 'Failed to update permission.'));
    }
  };

  const handleRemove = async (userId: number | null, label: string) => {
    if (!window.confirm(`Revoke ${label}'s access to this map?`)) return;
    setError(null);
    try {
      await permissionsService.removePermission(mapId, userId);
      await reload();
    } catch (e) {
      setError(extractApiError(e, 'Failed to revoke permission.'));
    }
  };

  const handleTogglePublic = async () => {
    setError(null);
    try {
      if (publicPerm) {
        await permissionsService.removePermission(mapId, null);
      } else {
        await permissionsService.setPermission(mapId, { userId: null, level: 'view' });
      }
      await reload();
    } catch (e) {
      setError(extractApiError(e, 'Failed to toggle public access.'));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>Sharing</h2>
        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <p className="page-loading">Loading permissions…</p>
        ) : (
          <>
            {/* Public toggle */}
            <section className="sharing-section">
              <h3>Public access</h3>
              <label className="sharing-public-toggle">
                <input
                  type="checkbox"
                  checked={publicPerm !== null}
                  onChange={handleTogglePublic}
                />
                Anyone with the link can view
              </label>
            </section>

            {/* Per-user grants */}
            <section className="sharing-section">
              <h3>People</h3>
              {userPerms.length === 0 ? (
                <p className="sharing-empty">No one else has access yet.</p>
              ) : (
                <ul className="sharing-grant-list">
                  {userPerms.map((p) => (
                    <li key={p.id} className="sharing-grant-row">
                      <span className="sharing-grant-name">
                        {p.username ?? `user #${p.userId}`}
                      </span>
                      <select
                        value={p.level}
                        onChange={(e) =>
                          handleSetLevel(p.userId, e.target.value as PermissionLevel)
                        }
                        aria-label={`Level for ${p.username ?? p.userId}`}
                      >
                        {LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>{lvl}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          handleRemove(p.userId, p.username ?? `user #${p.userId}`)
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <AddGrantForm
                members={members}
                userPerms={userPerms}
                onGrant={(userId, level) => handleSetLevel(userId, level)}
              />
            </section>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add-grant form ──────────────────────────────────────────────────────────

interface AddGrantFormProps {
  members: TenantMember[];
  userPerms: MapPermission[];
  onGrant: (userId: number, level: PermissionLevel) => Promise<void> | void;
}

function AddGrantForm({ members, userPerms, onGrant }: AddGrantFormProps) {
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('view');
  const [submitting, setSubmitting] = useState(false);

  // Filter out members already granted; the dropdown is the source of
  // truth when the listMembers call succeeded. If members list is empty
  // (call failed or no admin role on the tenant), fall back to a
  // numeric userId input.
  const grantedIds = new Set(userPerms.map((p) => p.userId));
  const candidates = members.filter((m) => !grantedIds.has(m.userId));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const idNum = Number(userId);
    if (!Number.isInteger(idNum) || idNum <= 0) return;
    setSubmitting(true);
    try {
      await onGrant(idNum, level);
      setUserId('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="sharing-add-form" onSubmit={handleSubmit}>
      {candidates.length > 0 ? (
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          required
          aria-label="User to grant access"
        >
          <option value="">Choose a tenant member…</option>
          {candidates.map((m) => (
            <option key={m.userId} value={String(m.userId)}>
              {m.username} ({m.email})
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          inputMode="numeric"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User ID"
          required
          aria-label="User ID to grant access"
        />
      )}
      <select
        value={level}
        onChange={(e) => setLevel(e.target.value as PermissionLevel)}
        aria-label="Permission level"
      >
        {LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>{lvl}</option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={submitting || !userId}
      >
        Grant
      </button>
    </form>
  );
}
