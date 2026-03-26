import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { useMap } from '@/hooks/useMap';

export function MapDetailPage() {
  const { mapId } = useParams<{ mapId: string }>();
  const { activeMap, loadMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapId) return;
    loadMap(Number(mapId))
      .catch(() => setError('Map not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [mapId, loadMap]);

  if (loading) return <div className="page-loading">Loading map…</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!activeMap) return null;

  return (
    <div className="map-page">
      <div className="map-page-header">
        <h2>{activeMap.title}</h2>
        {activeMap.description && <p>{activeMap.description}</p>}
        {(activeMap.permission === 'none') && (
          <p className="permission-notice">👁 View only — sign in for more access</p>
        )}
      </div>
      <MapView map={activeMap} />
    </div>
  );
}
