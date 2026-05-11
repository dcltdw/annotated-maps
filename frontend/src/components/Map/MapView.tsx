import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, ImageOverlay, Marker, Polyline, Polygon, Popup, CircleMarker, useMap as useLeafletMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { nodesService, nodeMediaService, edgesService } from '@/services/maps';
import { useAuthStore } from '@/store/authStore';
import { EdgeFormModal } from './EdgeFormModal';
import type {
  MapRecord,
  NodeRecord,
  NodeMediaRecord,
  GeoJsonGeometry,
  EdgeRecord,
} from '@/types';

// Fix for leaflet's default icon paths breaking under Vite's bundler.
// Standard workaround — assigning the imported asset URLs onto the
// internal `Default` prototype.
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

// ─── Geometry helpers ────────────────────────────────────────────────────────
// GeoJSON uses [lng, lat] order; Leaflet wants [lat, lng]. Convert per
// geometry type. The map's coordinateSystem.type tells us how to interpret
// the numbers (lat/lng for wgs84, x/y pixels for pixel) — same conversion
// rule applies because the swap is a property of the GeoJSON spec, not the
// CRS. For pixel maps this PR doesn't render; that's deferred to #91.

function pointLatLng(g: GeoJsonGeometry): [number, number] | null {
  if (g.type !== 'Point') return null;
  const c = g.coordinates as [number, number];
  return [c[1], c[0]];
}

function lineLatLngs(g: GeoJsonGeometry): [number, number][] | null {
  if (g.type !== 'LineString') return null;
  const c = g.coordinates as [number, number][];
  return c.map(([lng, lat]) => [lat, lng]);
}

function polygonLatLngs(g: GeoJsonGeometry): [number, number][][] | null {
  if (g.type !== 'Polygon') return null;
  const c = g.coordinates as [number, number][][];
  return c.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
}

// ─── Node popup with media ───────────────────────────────────────────────────

interface NodePopupProps {
  node: NodeRecord;
  media: NodeMediaRecord[];
}

function NodePopup({ node, media }: NodePopupProps) {
  return (
    <div className="node-popup">
      <h3>{node.name}</h3>
      {node.description && <p>{node.description}</p>}
      {media.length > 0 && (
        <div className="node-popup-media">
          {media
            .filter((m) => m.mediaType === 'image')
            .map((m) => (
              <img
                key={m.id}
                src={m.url}
                alt={m.caption || node.name}
                className="node-popup-thumb"
              />
            ))}
          {media.some((m) => m.mediaType === 'link') && (
            <ul className="node-popup-links">
              {media
                .filter((m) => m.mediaType === 'link')
                .map((m) => (
                  <li key={m.id}>
                    <a href={m.url} target="_blank" rel="noopener noreferrer">
                      {m.caption || m.url}
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Per-node renderer ───────────────────────────────────────────────────────

interface NodeLayerProps {
  node: NodeRecord;
  media: NodeMediaRecord[];
  onClick: (nodeId: number) => void;
}

function NodeLayer({ node, media, onClick }: NodeLayerProps) {
  if (!node.geoJson) return null;
  const handlers = { click: () => onClick(node.id) };

  if (node.geoJson.type === 'Point') {
    const ll = pointLatLng(node.geoJson);
    if (!ll) return null;
    return (
      <Marker position={ll} eventHandlers={handlers}>
        <Popup>
          <NodePopup node={node} media={media} />
        </Popup>
      </Marker>
    );
  }
  if (node.geoJson.type === 'LineString') {
    const lls = lineLatLngs(node.geoJson);
    if (!lls) return null;
    return (
      <Polyline
        positions={lls}
        pathOptions={{ color: node.color ?? '#3388ff' }}
        eventHandlers={handlers}
      >
        <Popup>
          <NodePopup node={node} media={media} />
        </Popup>
      </Polyline>
    );
  }
  if (node.geoJson.type === 'Polygon') {
    const lls = polygonLatLngs(node.geoJson);
    if (!lls) return null;
    return (
      <Polygon
        positions={lls}
        pathOptions={{ color: node.color ?? '#3388ff' }}
        eventHandlers={handlers}
      >
        <Popup>
          <NodePopup node={node} media={media} />
        </Popup>
      </Polygon>
    );
  }
  return null;
}

// ─── Per-edge renderer (#198) ────────────────────────────────────────────────
// Renders an edge as a Leaflet polyline from sourceNode's center to
// destNode's center. Both endpoints must have a Point geometry (the
// "center" of a node). Edges where either endpoint lacks a Point are
// skipped silently — the underlying data still exists, just not
// rendered (could be enhanced to use centroid for line/polygon nodes
// in a follow-up).
//
// Z-order: rendered BEFORE node markers in the JSX tree so node
// markers stay clickable on top.
//
// "Directed" indicator: a small CircleMarker at the dest endpoint.
// A real arrowhead would need leaflet-arrowheads or hand-rolled
// L.polylineDecorator geometry; the CircleMarker is a lightweight
// stand-in for v1 that conveys direction without a new dependency.
// (Filed as future polish in #199 / #200 if a real arrow is wanted.)

interface EdgeLayerProps {
  edge: EdgeRecord;
  sourceNode: NodeRecord;
  destNode: NodeRecord;
  onClick?: (edgeId: number) => void;
}

function EdgeLayer({ edge, sourceNode, destNode, onClick }: EdgeLayerProps) {
  if (!sourceNode.geoJson || sourceNode.geoJson.type !== 'Point') return null;
  if (!destNode.geoJson   || destNode.geoJson.type   !== 'Point') return null;

  const src = pointLatLng(sourceNode.geoJson);
  const dst = pointLatLng(destNode.geoJson);
  if (!src || !dst) return null;

  const color = edge.color ?? '#888';
  const handlers = onClick ? { click: () => onClick(edge.id) } : undefined;
  return (
    <>
      <Polyline
        positions={[src, dst]}
        pathOptions={{ color, weight: 3, opacity: 0.85 }}
        eventHandlers={handlers}
      />
      {edge.directed && (
        <CircleMarker
          center={dst}
          radius={6}
          pathOptions={{ color, fillColor: color, fillOpacity: 1 }}
          eventHandlers={handlers}
        />
      )}
    </>
  );
}

// ─── MapView (dispatches on coordinateSystem.type) ───────────────────────────

interface MapViewProps {
  map: MapRecord;
  /** Fired when a node layer is clicked on the map. */
  onNodeClick?: (nodeId: number) => void;
  /**
   * When set, fly the map to these coordinates. Setting it again with the
   * same values (new tuple identity) re-pans — clicking the same node
   * twice in the tree should re-center the map both times.
   */
  panTarget?: [number, number] | null;
}

// Mounted inside MapContainer so it has access to the leaflet map instance.
// Reacts to panTarget changes by flying the view to the requested coords.
function PanController({ target }: { target: [number, number] | null | undefined }) {
  const leafletMap = useLeafletMap();
  useEffect(() => {
    if (target) {
      leafletMap.flyTo(target, leafletMap.getZoom(), { duration: 0.4 });
    }
  }, [target, leafletMap]);
  return null;
}

export function MapView({ map, onNodeClick, panTarget }: MapViewProps) {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [edges, setEdges] = useState<EdgeRecord[]>([]);
  const [mediaByNode, setMediaByNode] = useState<Record<number, NodeMediaRecord[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwner = currentUserId !== undefined && currentUserId === map.ownerId;
  const xrayActive = isOwner && map.ownerXray;
  // Edit-permission gate for the edge toolbar (#199). The MapRecord's
  // `permission` field is the caller's effective access. Owner + edit
  // both qualify; view-only callers don't see the toolbar.
  const canEdit = map.permission === 'edit' || map.permission === 'owner';

  // ── Edge create / edit state machine (#199) ──────────────────────────────
  // edgeMode: idle = no special interaction; pickingSource = waiting for
  // the user to click the source node; pickingDest = source is captured,
  // waiting for the dest. The state transitions on each node click and
  // resets via Esc or after a successful create.
  type EdgeMode =
    | { kind: 'idle' }
    | { kind: 'pickingSource' }
    | { kind: 'pickingDest'; sourceId: number }
    | { kind: 'creating'; sourceId: number; destId: number }
    | { kind: 'editing'; edge: EdgeRecord };
  const [edgeMode, setEdgeMode] = useState<EdgeMode>({ kind: 'idle' });

  // Edge → endpoint nodes lookup. Built once per (nodes, edges) change so
  // we don't recompute per-render.
  const nodesById = useMemo(() => {
    const m = new Map<number, NodeRecord>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  useEffect(() => {
    let cancelled = false;
    nodesService
      .listNodes(map.id)
      .then((ns) => {
        if (cancelled) return;
        setNodes(ns);
        // Best-effort media fetch per node, in parallel. Failures don't
        // block rendering; a node just shows an empty media list.
        Promise.all(
          ns.map((n) =>
            nodeMediaService
              .listMedia(map.id, n.id)
              .then((m) => [n.id, m] as const)
              .catch(() => [n.id, [] as NodeMediaRecord[]] as const)
          )
        ).then((pairs) => {
          if (cancelled) return;
          const byId: Record<number, NodeMediaRecord[]> = {};
          for (const [id, m] of pairs) byId[id] = m;
          setMediaByNode(byId);
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load nodes for this map.');
      });

    // Edges are best-effort — failure here doesn't block the map.
    edgesService
      .listEdges(map.id)
      .then((es) => { if (!cancelled) setEdges(es); })
      .catch(() => { /* render the map without edges; not a fatal */ });

    return () => {
      cancelled = true;
    };
  }, [map.id]);

  // react-leaflet captures `eventHandlers` at marker-mount time and
  // doesn't always re-attach when the prop's identity changes — so a
  // closure-based handler always runs against the FIRST render's state
  // (idle), which broke the edge create flow until this ref-based
  // indirection. Pattern: keep a ref pointed at the latest "real"
  // handler, expose a stable wrapper that delegates to it. The wrapper's
  // identity never changes, so react-leaflet keeps the original binding;
  // each call re-reads the live ref and runs against current state.
  const handleClickRef = useRef<(nodeId: number) => void>(() => {});
  handleClickRef.current = (nodeId: number) => {
    // Edge create flow intercepts node clicks. In picking-source mode,
    // the click captures the source. In picking-dest mode, it captures
    // the dest (rejecting same-node-as-source) and opens the create
    // modal. Outside those modes, fall through to the default
    // selection callback.
    if (edgeMode.kind === 'pickingSource') {
      setEdgeMode({ kind: 'pickingDest', sourceId: nodeId });
      return;
    }
    if (edgeMode.kind === 'pickingDest') {
      if (nodeId === edgeMode.sourceId) {
        // Self-loop attempt — backend would 400; refuse early.
        return;
      }
      setEdgeMode({
        kind: 'creating',
        sourceId: edgeMode.sourceId,
        destId: nodeId,
      });
      return;
    }
    onNodeClick?.(nodeId);
  };
  const handleClick = useRef((nodeId: number) => {
    handleClickRef.current(nodeId);
  }).current;

  // Esc cancels mid-creation (any non-idle/non-modal state).
  useEffect(() => {
    if (edgeMode.kind !== 'pickingSource' && edgeMode.kind !== 'pickingDest') {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEdgeMode({ kind: 'idle' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edgeMode.kind]);

  // After create / update / delete, refetch edges so the rendering
  // layer reflects the latest state. Cheaper than splicing the local
  // array and avoids drift if the response shape changes.
  const refetchEdges = () => {
    edgesService.listEdges(map.id)
      .then((es) => setEdges(es))
      .catch(() => { /* keep stale list; same posture as initial load */ });
  };

  // Same staleness mitigation as handleClick — the EdgeLayer's onClick
  // is captured at first mount by react-leaflet, so without ref-stable
  // wrapping the latest `edges` and `edgeMode` would never be visible.
  const handleEdgeClickRef = useRef<(edgeId: number) => void>(() => {});
  handleEdgeClickRef.current = (edgeId: number) => {
    if (edgeMode.kind !== 'idle') return;  // mid-flow; ignore
    if (!canEdit) return;                  // view-only; no edit modal
    const e = edges.find((x) => x.id === edgeId);
    if (e) setEdgeMode({ kind: 'editing', edge: e });
  };
  const handleEdgeClick = useRef((edgeId: number) => {
    handleEdgeClickRef.current(edgeId);
  }).current;

  // All three renderers share the same node-layer rendering; the only
  // difference is the MapContainer's CRS + base layer (or lack thereof).
  // The GeoJSON [lng, lat] → Leaflet [lat, lng] swap in `pointLatLng` /
  // `lineLatLngs` / `polygonLatLngs` is purely about GeoJSON's axis
  // convention and applies regardless of CRS — for pixel maps the
  // numbers mean (x, y) but the swap is still correct.

  const cs = map.coordinateSystem;

  // Edges render BEFORE node markers so node clicks aren't shadowed.
  // Pass onClick only when canEdit AND not mid-creation — mid-creation
  // node clicks would otherwise compete with edge clicks for the same
  // gesture.
  const edgeLayerOnClick = canEdit && edgeMode.kind === 'idle'
    ? handleEdgeClick
    : undefined;
  const renderEdgeLayers = () =>
    edges.map((e) => {
      const src = nodesById.get(e.sourceNodeId);
      const dst = nodesById.get(e.destNodeId);
      if (!src || !dst) return null;  // endpoint not loaded (filtered out by visibility)
      return (
        <EdgeLayer
          key={e.id}
          edge={e}
          sourceNode={src}
          destNode={dst}
          onClick={edgeLayerOnClick}
        />
      );
    });

  // Toolbar + status hint shown above the map. Toolbar visible only
  // when caller has edit access; hint reflects the current mode so the
  // user knows what to do next (mirrors MapBox / OSM iD draw flows).
  const renderToolbar = () => {
    if (!canEdit) return null;
    const startEdgeCreate = () => setEdgeMode({ kind: 'pickingSource' });
    const cancelEdgeCreate = () => setEdgeMode({ kind: 'idle' });
    if (edgeMode.kind === 'idle') {
      return (
        <div className="map-view-toolbar">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={startEdgeCreate}
          >
            + Edge
          </button>
        </div>
      );
    }
    if (edgeMode.kind === 'pickingSource') {
      return (
        <div className="map-view-toolbar map-view-toolbar-active">
          <span>Click the source node (Esc to cancel)</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdgeCreate}>
            Cancel
          </button>
        </div>
      );
    }
    if (edgeMode.kind === 'pickingDest') {
      return (
        <div className="map-view-toolbar map-view-toolbar-active">
          <span>Click the destination node (Esc to cancel)</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdgeCreate}>
            Cancel
          </button>
        </div>
      );
    }
    return null;  // creating / editing — modal is the affordance
  };

  const renderEdgeModal = () => {
    if (edgeMode.kind === 'creating') {
      const src = nodesById.get(edgeMode.sourceId);
      const dst = nodesById.get(edgeMode.destId);
      if (!src || !dst) {
        // Race: a node disappeared between picking and modal mount;
        // bail back to idle.
        setEdgeMode({ kind: 'idle' });
        return null;
      }
      return (
        <EdgeFormModal
          mode="create"
          mapId={map.id}
          sourceNode={src}
          destNode={dst}
          onSaved={() => {
            setEdgeMode({ kind: 'idle' });
            refetchEdges();
          }}
          onClose={() => setEdgeMode({ kind: 'idle' })}
        />
      );
    }
    if (edgeMode.kind === 'editing') {
      const src = nodesById.get(edgeMode.edge.sourceNodeId);
      const dst = nodesById.get(edgeMode.edge.destNodeId);
      if (!src || !dst) {
        setEdgeMode({ kind: 'idle' });
        return null;
      }
      return (
        <EdgeFormModal
          mode="edit"
          mapId={map.id}
          sourceNode={src}
          destNode={dst}
          initial={edgeMode.edge}
          onSaved={() => {
            setEdgeMode({ kind: 'idle' });
            refetchEdges();
          }}
          onDeleted={() => {
            setEdgeMode({ kind: 'idle' });
            refetchEdges();
          }}
          onClose={() => setEdgeMode({ kind: 'idle' })}
        />
      );
    }
    return null;
  };

  const renderNodeLayers = () =>
    nodes.map((n) => (
      <NodeLayer
        key={n.id}
        node={n}
        media={mediaByNode[n.id] ?? []}
        onClick={handleClick}
      />
    ));

  if (cs.type === 'pixel') {
    // CRS.Simple maps coordinate (0, 0) to the top-left. The image
    // overlay spans from (0, 0) to (height, width) — Leaflet expects
    // bounds as [[y, x], [y, x]]. Viewport's (x, y) center maps the
    // same way: pass [viewport.y, viewport.x].
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [cs.height, cs.width],
    ];
    const center: [number, number] = [cs.viewport.y, cs.viewport.x];
    return (
      <div className="map-view">
        {loadError && <div className="alert alert-error">{loadError}</div>}
        {renderToolbar()}
        {renderEdgeModal()}
        {xrayActive && (
          <div className="alert alert-xray" role="status">
            🔍 Owner X-ray active — you can see all nodes regardless of visibility tagging.
          </div>
        )}
        <MapContainer
          crs={L.CRS.Simple}
          center={center}
          zoom={cs.viewport.zoom}
          minZoom={-5}
          className="map-view-leaflet"
        >
          <ImageOverlay url={cs.image_url} bounds={bounds} />
          {renderEdgeLayers()}
          {renderNodeLayers()}
          <PanController target={panTarget} />
        </MapContainer>
      </div>
    );
  }

  if (cs.type === 'blank') {
    // No base layer — just the canvas + nodes. Center on the middle of
    // the extent so the user sees something at default zoom.
    const center: [number, number] = [cs.extent.y / 2, cs.extent.x / 2];
    const maxBounds: L.LatLngBoundsExpression = [
      [0, 0],
      [cs.extent.y, cs.extent.x],
    ];
    return (
      <div className="map-view">
        {loadError && <div className="alert alert-error">{loadError}</div>}
        {renderToolbar()}
        {renderEdgeModal()}
        {xrayActive && (
          <div className="alert alert-xray" role="status">
            🔍 Owner X-ray active — you can see all nodes regardless of visibility tagging.
          </div>
        )}
        <MapContainer
          crs={L.CRS.Simple}
          center={center}
          zoom={0}
          minZoom={-5}
          maxBounds={maxBounds}
          className="map-view-leaflet map-view-blank"
        >
          {renderEdgeLayers()}
          {renderNodeLayers()}
          <PanController target={panTarget} />
        </MapContainer>
      </div>
    );
  }

  // wgs84 — standard OSM tile layer
  const center: [number, number] = [cs.center.lat, cs.center.lng];
  return (
    <div className="map-view">
      {loadError && <div className="alert alert-error">{loadError}</div>}
      {renderToolbar()}
      {renderEdgeModal()}
      {xrayActive && (
        <div className="alert alert-xray" role="status">
          🔍 Owner X-ray active — you can see all nodes regardless of visibility tagging.
        </div>
      )}
      <MapContainer center={center} zoom={cs.zoom} className="map-view-leaflet">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {renderEdgeLayers()}
        {renderNodeLayers()}
        <PanController target={panTarget} />
      </MapContainer>
    </div>
  );
}
