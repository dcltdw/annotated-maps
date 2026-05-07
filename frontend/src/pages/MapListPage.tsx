import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMap } from '@/hooks/useMap';
import { mapsService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { CreateMapRequest, UpdateMapRequest, MapRecord } from '@/types';

export function MapListPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { maps, loadMaps } = useMap();
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // Edit modal state (#160): when non-null, modal opens in edit mode
  // pre-populated with this map's title + description.
  const [editingMap, setEditingMap] = useState<MapRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMaps().finally(() => setLoading(false));
  }, [loadMaps]);

  const handleDelete = async (m: MapRecord) => {
    if (!window.confirm(`Delete map "${m.title}"? This cannot be undone.`)) return;
    try {
      await mapsService.deleteMap(m.id);
      await loadMaps();
    } catch (e) {
      setError(extractApiError(e, 'Failed to delete map.'));
    }
  };

  if (loading) return <div className="page-loading">Loading maps…</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>My Maps</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Map
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {(showCreate || editingMap) && (
        <MapFormModal
          mode={editingMap ? 'edit' : 'create'}
          tenantId={tenantId}
          existingMap={editingMap ?? undefined}
          onClose={() => {
            setShowCreate(false);
            setEditingMap(null);
          }}
          onSaved={async () => {
            setShowCreate(false);
            setEditingMap(null);
            await loadMaps();
          }}
        />
      )}

      {maps.length === 0 ? (
        <div className="empty-state">
          <p>You don't have any maps yet.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Create your first map
          </button>
        </div>
      ) : (
        <div className="map-grid">
          {maps.map((map) => (
            <MapCard
              key={map.id}
              map={map}
              tenantId={tenantId}
              onEdit={() => setEditingMap(map)}
              onDelete={() => handleDelete(map)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Per-card with ⋯ menu (#160) ─────────────────────────────────────────────
// The card body is a Link to the detail page; the ⋯ menu sits in a
// non-Link corner so its clicks don't navigate.

interface MapCardProps {
  map: MapRecord;
  tenantId: string | undefined;
  onEdit: () => void;
  onDelete: () => void;
}

function MapCard({ map, tenantId, onEdit, onDelete }: MapCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOwner = map.permission === 'owner';

  return (
    <div className="map-card-wrapper">
      <Link to={`/tenants/${tenantId}/maps/${map.id}`} className="map-card">
        <h3>{map.title}</h3>
        {map.description && <p>{map.description}</p>}
        <span className="map-card-permission">
          {map.permission === 'owner' ? '👑 Owner' : map.permission}
        </span>
      </Link>
      {isOwner && (
        <div
          className="map-card-menu-wrapper"
          tabIndex={-1}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setMenuOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="map-card-menu"
            aria-label="Map actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((m) => !m);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="map-card-menu-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                className="map-card-menu-item"
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                className="map-card-menu-item map-card-menu-item-danger"
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Map form modal — create + edit (#160) ───────────────────────────────────
// Generalized from the original "+ New Map" form. Mode-specific behavior:
//   create — blank fields, navigates to the new map's detail page on submit
//   edit   — pre-populated from existingMap, stays on the list after save;
//            coordinate system is read-only (changing a map's coord system
//            mid-flight would invalidate every node's geometry — out of
//            scope, future ticket)

interface MapFormModalProps {
  mode: 'create' | 'edit';
  tenantId: string | undefined;
  existingMap?: MapRecord;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function MapFormModal({
  mode,
  tenantId,
  existingMap,
  onClose,
  onSaved,
}: MapFormModalProps) {
  const { createMap, updateMap } = useMap();
  const [title, setTitle] = useState(existingMap?.title ?? '');
  const [description, setDescription] = useState(existingMap?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === 'edit';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isEdit && existingMap) {
        // Partial update: only send fields that actually changed.
        const req: UpdateMapRequest = {};
        if (title !== existingMap.title) req.title = title;
        if (description !== (existingMap.description ?? '')) req.description = description;
        if (Object.keys(req).length === 0) {
          await onSaved();
          return;
        }
        await updateMap(existingMap.id, req);
        await onSaved();
        return;
      }

      // mode === 'create'
      const data: CreateMapRequest = {
        title,
        description,
        // Default new maps to a generic WGS84 view; the user can swap to
        // pixel or blank coordinate systems via API once the picker UI
        // lands (separate ticket).
        coordinateSystem: {
          type: 'wgs84',
          center: { lat: 0, lng: 0 },
          zoom: 3,
        },
      };
      const map = await createMap(data);
      // On create, navigate straight into the new map's detail page —
      // matches the pre-#160 behavior so users don't lose that flow.
      window.location.href = `/tenants/${tenantId}/maps/${map.id}`;
    } catch (err) {
      setError(extractApiError(err, isEdit ? 'Failed to update map.' : 'Failed to create map.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isEdit ? 'Edit Map' : 'Create Map'}</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="map-title">Title</label>
            <input
              id="map-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="My Hiking Trails"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="map-description">Description</label>
            <textarea
              id="map-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
            />
          </div>
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
              disabled={saving || !title.trim()}
            >
              {saving ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
