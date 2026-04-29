import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { useMap } from '@/hooks/useMap';

// Stubbed for #92. The full edit / delete / notes-panel UI lands in #101
// (map view rebuild) + #103 (node detail + inline notes CRUD). This page
// currently just loads the map record (so the listing-page → detail-page
// nav still works) and renders the MapView stub.

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const navigate = useNavigate();
  const { activeMap, loadMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <MapView map={activeMap} />
      <button className="btn btn-ghost" onClick={() => navigate(`/tenants/${tenantId}/maps`)}>
        Back to maps
      </button>
    </div>
  );
}
