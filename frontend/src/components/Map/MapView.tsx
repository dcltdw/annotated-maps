import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { nodesService, nodeMediaService } from '@/services/maps';
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
  /** Fired when a node is clicked. The detail panel that listens lands in #93. */
  onNodeClick?: (nodeId: number) => void;
}

export function MapView({ map, onNodeClick }: MapViewProps) {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [mediaByNode, setMediaByNode] = useState<Record<number, NodeMediaRecord[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (map.coordinateSystem.type !== 'wgs84') {
    // Pixel and blank renderers land with #91's frontend follow-up. Stub
    // here so the page is intelligible until then.
    return (
      <div className="map-view-stub">
        <p>
          <strong>Coordinate system <code>{map.coordinateSystem.type}</code>: rendering coming in #91.</strong>
        </p>
        <p>This map has {nodes.length} node(s); the renderer for non-WGS84 backdrops isn't wired yet.</p>
      </div>
    );
  }

  const cs = map.coordinateSystem;
  const center: [number, number] = [cs.center.lat, cs.center.lng];

  return (
    <div className="map-view">
      {loadError && <div className="alert alert-error">{loadError}</div>}
      <MapContainer center={center} zoom={cs.zoom} className="map-view-leaflet">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {nodes.map((n) => (
          <NodeLayer
            key={n.id}
            node={n}
            media={mediaByNode[n.id] ?? []}
            onClick={handleClick}
          />
        ))}
      </MapContainer>
    </div>
  );
}
