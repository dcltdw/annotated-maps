import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { NodeTreePanel } from '@/components/Tree/NodeTreePanel';
import { NodeDetailPanel } from '@/components/Detail/NodeDetailPanel';
import { useMap } from '@/hooks/useMap';

// Map detail page. NodeTreePanel + MapView + NodeDetailPanel are all wired
// up to a shared selectedNodeId state — clicking a node in any surface
// highlights it everywhere; the detail panel re-renders to show its
// metadata, parent breadcrumb, media, and inline notes CRUD.

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const navigate = useNavigate();
  const { activeMap, loadMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [panTarget, setPanTarget] = useState<[number, number] | null>(null);

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
      <div className="map-detail-layout">
        <NodeTreePanel
          mapId={activeMap.id}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onPanToNode={(coords) => setPanTarget(coords)}
        />
        <MapView
          map={activeMap}
          onNodeClick={setSelectedNodeId}
          panTarget={panTarget}
        />
      </div>
      <NodeDetailPanel
        mapId={activeMap.id}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
      />
      <button className="btn btn-ghost" onClick={() => navigate(`/tenants/${tenantId}/maps`)}>
        Back to maps
      </button>
    </div>
  );
}
