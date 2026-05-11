import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { MapSharingModal } from '@/components/Map/MapSharingModal';
import { NodeTreePanel } from '@/components/Tree/NodeTreePanel';
import { NodeDetailPanel } from '@/components/Detail/NodeDetailPanel';
import { useMap } from '@/hooks/useMap';
import { useAuthStore } from '@/store/authStore';
import { mapsService } from '@/services/maps';
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
  // `?node=X` query param lets cross-page links (e.g. plot member rows
  // on /tenants/:tid/plots) deep-link into a specific node. We honor it
  // exactly once per map load — see the effect below — so subsequent
  // user-driven node selections aren't fought by stale URL state.
  const [searchParams] = useSearchParams();
  const { activeMap, loadMap, updateMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [panTarget, setPanTarget] = useState<[number, number] | null>(null);
  // "+ Edge from here" cross-component command (#200). NodeDetailPanel
  // fires this; MapView reads it via prop. Object identity changes per
  // command so MapView's effect re-fires even when the same node is
  // chosen twice.
  const [edgeStartFrom, setEdgeStartFrom] =
    useState<{ sourceNodeId: number } | null>(null);
  // Bump counter for external edge mutations (e.g., EdgesSection delete
  // from the detail panel). MapView's effect on this prop refetches so
  // the map render stays in sync.
  const [edgesRefreshKey, setEdgesRefreshKey] = useState(0);
  const [xraySaving, setXraySaving] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [showSharing, setShowSharing] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!mapId) return;
    setLoading(true);
    loadMap(Number(mapId))
      .catch(() => setError('Map not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [mapId, loadMap]);

  // Honor ?node=N once per map load. Re-running this on every searchParams
  // change would clobber the user's clicks if they navigated within the
  // same map — keying on mapId means it only fires when the page (re)mounts
  // for a different map.
  useEffect(() => {
    if (!mapId) return;
    const nodeParam = searchParams.get('node');
    if (nodeParam) {
      const n = Number(nodeParam);
      if (Number.isFinite(n)) setSelectedNodeId(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId]);

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

  // Delete-from-detail-page (#160). Edit-from-detail isn't here — users
  // can navigate to /tenants/{tid}/maps to edit. v1 minimum keeps this
  // page focused on viewing/working with the map.
  const handleDeleteMap = async () => {
    if (!activeMap) return;
    if (!window.confirm(`Delete map "${activeMap.title}"? This cannot be undone.`)) return;
    try {
      await mapsService.deleteMap(activeMap.id);
      navigate(`/tenants/${tenantId}/maps`);
    } catch (e) {
      setXrayError(extractApiError(e, 'Failed to delete map.'));
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{activeMap.title}</h1>
        <div className="header-actions">
          {isOwner && (
            <label className="owner-xray-toggle" title="Owner X-ray lets the map owner see every location regardless of visibility tagging.">
              <input
                type="checkbox"
                checked={activeMap.ownerXray}
                onChange={handleToggleXray}
                disabled={xraySaving}
              />
              {xraySaving ? 'Saving…' : 'Owner X-ray'}
            </label>
          )}
          {isOwner && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowSharing(true)}
              title="Manage who can view and edit this map"
            >
              Share
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleDeleteMap}
              title="Delete this map (and all its locations + notes)"
            >
              Delete map
            </button>
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
          coordinateSystem={activeMap.coordinateSystem}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onPanToNode={(coords) => setPanTarget(coords)}
          onLocationDeleted={() => setSelectedNodeId(null)}
        />
        <MapView
          map={activeMap}
          onNodeClick={setSelectedNodeId}
          panTarget={panTarget}
          edgeStartFrom={edgeStartFrom}
          edgesRefreshKey={edgesRefreshKey}
        />
      </div>
      <NodeDetailPanel
        mapId={activeMap.id}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onStartEdgeFromNode={(nodeId) => setEdgeStartFrom({ sourceNodeId: nodeId })}
        onEdgesChanged={() => setEdgesRefreshKey((k) => k + 1)}
      />
      <button className="btn btn-ghost" onClick={() => navigate(`/tenants/${tenantId}/maps`)}>
        Back to maps
      </button>
      {showSharing && (
        <MapSharingModal
          mapId={activeMap.id}
          onClose={() => setShowSharing(false)}
        />
      )}
    </div>
  );
}
