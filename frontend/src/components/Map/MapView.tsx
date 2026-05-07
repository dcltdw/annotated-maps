import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, ImageOverlay, Marker, Polyline, Polygon, Popup, useMap as useLeafletMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { nodesService, nodeMediaService } from '@/services/maps';
import { useAuthStore } from '@/store/authStore';
import type {
  MapRecord,
  NodeRecord,
  NodeMediaRecord,
  GeoJsonGeometry,
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
  const [mediaByNode, setMediaByNode] = useState<Record<number, NodeMediaRecord[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwner = currentUserId !== undefined && currentUserId === map.ownerId;
  const xrayActive = isOwner && map.ownerXray;

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
    return () => {
      cancelled = true;
    };
  }, [map.id]);

  const handleClick = (nodeId: number) => {
    onNodeClick?.(nodeId);
  };

  // All three renderers share the same node-layer rendering; the only
  // difference is the MapContainer's CRS + base layer (or lack thereof).
  // The GeoJSON [lng, lat] → Leaflet [lat, lng] swap in `pointLatLng` /
  // `lineLatLngs` / `polygonLatLngs` is purely about GeoJSON's axis
  // convention and applies regardless of CRS — for pixel maps the
  // numbers mean (x, y) but the swap is still correct.

  const cs = map.coordinateSystem;
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
        {renderNodeLayers()}
        <PanController target={panTarget} />
      </MapContainer>
    </div>
  );
}
