import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { NodeTreePanel } from '@/components/Tree/NodeTreePanel';
import { NodeDetailPanel } from '@/components/Detail/NodeDetailPanel';
import { useMap } from '@/hooks/useMap';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/utils/errors';

// Map detail page. NodeTreePanel + MapView + NodeDetailPanel are all wired
// up to a shared selectedNodeId state — clicking a node in any surface
// highlights it everywhere; the detail panel re-renders to show its
// metadata, parent breadcrumb, media, and inline notes CRUD.
//
// The owner_xray toggle in the header (#106) is owner-only: only the map
// owner sees the control. Flipping it calls mapsService.updateMap;
// MapView reacts to the resulting `map.ownerXray` change to render the
// "Owner X-ray active" banner above the map for the owner.

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const navigate = useNavigate();
  const { activeMap, loadMap, updateMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [panTarget, setPanTarget] = useState<[number, number] | null>(null);
  const [xraySaving, setXraySaving] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);

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

  const isOwner = currentUserId !== undefined && currentUserId === activeMap.ownerId;

  const handleToggleXray = async () => {
    setXrayError(null);
    setXraySaving(true);
    try {
      await updateMap(activeMap.id, { ownerXray: !activeMap.ownerXray });
      // The hook re-fetches and updates `activeMap`, so MapView's banner
      // and this control's label both refresh on the next render.
    } catch (e) {
      setXrayError(extractApiError(e, 'Failed to toggle owner x-ray.'));
    } finally {
      setXraySaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{activeMap.title}</h1>
        <div className="header-actions">
          {isOwner && (
            <label className="owner-xray-toggle" title="Owner X-ray lets the map owner see every node regardless of visibility tagging.">
              <input
                type="checkbox"
                checked={activeMap.ownerXray}
                onChange={handleToggleXray}
                disabled={xraySaving}
              />
              {xraySaving ? 'Saving…' : 'Owner X-ray'}
            </label>
          )}
          <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
            ← Back to maps
          </Link>
        </div>
      </div>
      {xrayError && <div className="alert alert-error">{xrayError}</div>}
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
