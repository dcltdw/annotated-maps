import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMap } from '@/hooks/useMap';
import type { CreateMapRequest } from '@/types';

export function MapListPage() {
  const { maps, loadMaps, createMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    loadMaps().finally(() => setLoading(false));
  }, [loadMaps]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const data: CreateMapRequest = {
      title,
      description,
      centerLat: 0,
      centerLng: 0,
      zoom: 3,
    };
    const map = await createMap(data);
    setShowCreate(false);
    setTitle('');
    setDescription('');
    // Navigate to new map
    window.location.href = `/maps/${map.id}`;
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
              <div className="form-group">
                <label>Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="My Hiking Trails"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description…"
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create
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
            <Link to={`/maps/${map.id}`} key={map.id} className="map-card">
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
