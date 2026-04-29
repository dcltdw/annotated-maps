import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { useMap } from '@/hooks/useMap';

// Map detail page. The map view itself rebuilt in #101; the tree panel,
// node detail view, and edit/delete affordances follow in #93 / #103.
// For now: load the map record + render the MapView. Node click events
// surface as a transient banner so the wiring is observable until #93's
// detail panel listens for them properly.

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const navigate = useNavigate();
  const { activeMap, loadMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  useEffect(() => {
    if (!mapId) return;
    setLoading(true);
    loadMap(Number(mapId))
      .catch(() => setError('Map not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [mapId, loadMap]);

  if (loading) return <div className="page-loading">Loading map…</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!activeMap) return <div className="page-error">No map loaded.</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{activeMap.title}</h1>
        <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
          ← Back to maps
        </Link>
      </div>
      {activeMap.description && <p>{activeMap.description}</p>}
      {selectedNodeId !== null && (
        <div className="alert alert-info">
          Selected node #{selectedNodeId}. Detail panel lands in #93.
        </div>
      )}
      <MapView map={activeMap} onNodeClick={setSelectedNodeId} />
      <button className="btn btn-ghost" onClick={() => navigate(`/tenants/${tenantId}/maps`)}>
        Back to maps
      </button>
    </div>
  );
}
