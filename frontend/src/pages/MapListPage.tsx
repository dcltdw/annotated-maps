import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMap } from '@/hooks/useMap';
import { extractApiError } from '@/utils/errors';
import type { CreateMapRequest } from '@/types';

export function MapListPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { maps, loadMaps, createMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    loadMaps().finally(() => setLoading(false));
  }, [loadMaps]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      // Default new maps to a generic WGS84 view; the user can swap to
      // pixel or blank coordinate systems via update once that UI lands
      // (#101 series).
      const data: CreateMapRequest = {
        title,
        description,
        coordinateSystem: {
          type: 'wgs84',
          center: { lat: 0, lng: 0 },
          zoom: 3,
        },
      };
      const map = await createMap(data);
      setShowCreate(false);
      setTitle('');
      setDescription('');
      window.location.href = `/tenants/${tenantId}/maps/${map.id}`;
    } catch (err) {
      setCreateError(extractApiError(err, 'Failed to create map.'));
    } finally {
      setCreating(false);
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

      {showCreate && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Create Map</h2>
            <form onSubmit={handleCreate} className="auth-form">
              {createError && <div className="alert alert-error">{createError}</div>}
              <div className="form-group">
                <label htmlFor="map-title">Title</label>
                <input
                  id="map-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="My Hiking Trails"
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
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
            <Link to={`/tenants/${tenantId}/maps/${map.id}`} key={map.id} className="map-card">
              <h3>{map.title}</h3>
              {map.description && <p>{map.description}</p>}
              <span className="map-card-permission">
                {map.permission === 'owner' ? '👑 Owner' : map.permission}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
