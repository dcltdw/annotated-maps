import { useEffect, useState } from 'react';
import {
  visibilityGroupsService,
  nodesService,
  notesService,
} from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { VisibilityGroup, SetVisibilityRequest } from '@/types';

// Phase 2g.h (#105). Shared per-node / per-note visibility editor.
//
// The backend's GET /…/visibility endpoint returns the *raw* stored state
// for the node or note: `{ override: boolean, groupIds: number[] }`. When
// `override = false` the entity inherits visibility from its parent chain
// (for nodes) or its attached node (for notes). The inherited groups
// aren't exposed by these endpoints — read-time filtering computes the
// effective set inside a CTE. So this editor faithfully shows only what
// the user can directly control:
//
//   - override = true  → the explicit list of tagged groups (editable)
//   - override = false → "inherits from parent chain" (no list shown)
//
// A future ticket can add a "where am I inheriting from?" call once the
// API exposes effective visibility per-node / per-note.

type Kind = 'node' | 'note';

interface VisibilityEditorProps {
  kind: Kind;
  /** id of the node or note */
  entityId: number;
  mapId: number;
  tenantId?: number;
  /** Optional callback fired after a successful save. */
  onSaved?: () => void;
}

export function VisibilityEditor({
  kind,
  entityId,
  mapId,
  tenantId,
  onSaved,
}: VisibilityEditorProps) {
  const [override, setOverride] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [availableGroups, setAvailableGroups] = useState<VisibilityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Display name for the kind. Code calls this "node" but UI says
  // "location" (#150 design discussion — "node" is graph-theory jargon).
  const displayKind = kind === 'node' ? 'location' : kind;
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    const stateP = kind === 'node'
      ? nodesService.getVisibility(mapId, entityId, tenantId)
      : notesService.getVisibility(mapId, entityId, tenantId);

    Promise.all([
      stateP,
      visibilityGroupsService.listGroups(tenantId).catch(() => [] as VisibilityGroup[]),
    ])
      .then(([state, groups]) => {
        if (cancelled) return;
        setOverride(state.override);
        setSelectedGroupIds(new Set(state.groupIds));
        setAvailableGroups(groups);
      })
      .catch((e) => {
        if (!cancelled) setError(extractApiError(e, 'Failed to load visibility.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [kind, entityId, mapId, tenantId]);

  const toggleGroup = (groupId: number, enabled: boolean) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(groupId); else next.delete(groupId);
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    setSaveMessage(null);
    setSaving(true);

    // Always send both fields. groupIds is dropped server-side anyway when
    // the route doesn't have a body for it; sending [] when override=false
    // is harmless (the server stores the rows for re-activation later, per
    // the rule from #86 / #87).
    const body: SetVisibilityRequest = {
      override,
      groupIds: Array.from(selectedGroupIds),
    };
    try {
      if (kind === 'node') {
        await nodesService.setVisibility(mapId, entityId, body, tenantId);
      } else {
        await notesService.setVisibility(mapId, entityId, body, tenantId);
      }
      setSaveMessage('Saved.');
      onSaved?.();
    } catch (e) {
      setError(extractApiError(e, 'Failed to save visibility.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="visibility-editor">Loading visibility…</div>;

  return (
    <div className="visibility-editor">
      {error && <div className="alert alert-error">{error}</div>}
      <label className="visibility-override-toggle">
        <input
          type="checkbox"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
          disabled={saving}
        />
        Override (explicit visibility for this {displayKind})
      </label>

      {!override && (
        <p className="visibility-editor-help">
          Inheriting visibility from the parent chain. Toggle override to
          set an explicit set of visibility groups for this {displayKind}.
        </p>
      )}

      {override && (
        availableGroups.length === 0 ? (
          <p className="visibility-editor-help">
            No visibility groups exist on this tenant. With override on and
            no groups selected, only tenant admins (and map owners with
            <code> owner_xray</code>) will see this {kind}.
          </p>
        ) : (
          <ul className="visibility-group-checklist">
            {availableGroups.map((g) => (
              <li key={g.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.has(g.id)}
                    onChange={(e) => toggleGroup(g.id, e.target.checked)}
                    disabled={saving}
                  />
                  <span>{g.name}</span>
                  {g.managesVisibility && (
                    <span className="visibility-group-badge-mini">🔑</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )
      )}

      <div className="visibility-editor-actions">
        {saveMessage && <span className="visibility-editor-message">{saveMessage}</span>}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save visibility'}
        </button>
      </div>
    </div>
  );
}
