import { useEffect, useState } from 'react';
import { nodesService } from '@/services/maps';
import type { NodeRecord, GeoJsonGeometry } from '@/types';

// NodeTreePanel — Phase 2g.d (#93). Replaces the deleted flat NotesPanel
// from before the rebuild with the tree-of-nodes UI.
//
// Top-level rows are loaded eagerly (parentId=null filter); each row
// fetches its children lazily on first expand. Selecting a row emits
// the node id upward; clicking a row with geometry also pans the map
// to a derived location (Point: itself, LineString/Polygon: first
// vertex). Detail view + inline note CRUD lands in #103; this PR
// exposes the selectedNodeId state for that ticket to consume.

interface NodeTreePanelProps {
  mapId: number;
  selectedNodeId: number | null;
  onSelectNode: (nodeId: number) => void;
  onPanToNode: (coords: [number, number]) => void;
}

export function NodeTreePanel({
  mapId,
  selectedNodeId,
  onSelectNode,
  onPanToNode,
}: NodeTreePanelProps) {
  const [rootNodes, setRootNodes] = useState<NodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    nodesService
      .listNodes(mapId, null)
      .then((ns) => {
        if (!cancelled) setRootNodes(ns);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load nodes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  return (
    <aside className="node-tree-panel">
      <div className="node-tree-header">
        <h3>Nodes</h3>
      </div>
      {loading && <div className="node-tree-state">Loading…</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && rootNodes.length === 0 && (
        <div className="node-tree-state">No nodes on this map yet.</div>
      )}
      <div className="node-tree-list">
        {rootNodes.map((node) => (
          <NodeTreeRow
            key={node.id}
            mapId={mapId}
            node={node}
            depth={0}
            selectedNodeId={selectedNodeId}
            onSelect={onSelectNode}
            onPan={onPanToNode}
          />
        ))}
      </div>
    </aside>
  );
}

// ─── Per-row recursive component ─────────────────────────────────────────────

interface NodeTreeRowProps {
  mapId: number;
  node: NodeRecord;
  depth: number;
  selectedNodeId: number | null;
  onSelect: (nodeId: number) => void;
  onPan: (coords: [number, number]) => void;
}

function NodeTreeRow({
  mapId,
  node,
  depth,
  selectedNodeId,
  onSelect,
  onPan,
}: NodeTreeRowProps) {
  // `children === null` means we haven't fetched yet; `[]` means we have
  // and there are none. The toggle is shown until we know for certain
  // the node is a leaf (then it's a placeholder for layout consistency).
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<NodeRecord[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (children === null && !loadingChildren) {
      setLoadingChildren(true);
      setChildrenError(null);
      try {
        const fetched = await nodesService.listChildren(mapId, node.id);
        setChildren(fetched);
        setExpanded(true);
      } catch {
        setChildrenError('Failed to load children.');
      } finally {
        setLoadingChildren(false);
      }
    } else {
      setExpanded((e) => !e);
    }
  };

  const handleSelect = () => {
    onSelect(node.id);
    if (node.geoJson) {
      const coords = derivePanCoords(node.geoJson);
      if (coords) onPan(coords);
    }
  };

  const isLeaf = children !== null && children.length === 0;
  const isSelected = selectedNodeId === node.id;

  return (
    <div className="node-tree-row" style={{ paddingLeft: `${depth * 16}px` }}>
      <div className={`node-tree-row-inner ${isSelected ? 'selected' : ''}`}>
        {isLeaf ? (
          <span className="node-tree-toggle node-tree-toggle-spacer" />
        ) : (
          <button
            type="button"
            className="node-tree-toggle"
            onClick={handleToggle}
            disabled={loadingChildren}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {loadingChildren ? '…' : expanded ? '▼' : '▶'}
          </button>
        )}
        {node.color && (
          <span
            className="node-tree-color"
            style={{ background: node.color }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className="node-tree-name"
          onClick={handleSelect}
          title={node.name}
        >
          {node.name}
        </button>
        {/* Move/copy menu placeholder — wired up when the move/copy frontend
            ticket lands; backend support is in #90 / #100. */}
        <button
          type="button"
          className="node-tree-menu"
          title="Move/copy (coming soon)"
          disabled
          aria-label="Node actions"
        >
          ⋯
        </button>
      </div>
      {childrenError && <div className="alert alert-error">{childrenError}</div>}
      {expanded && children && children.length > 0 && (
        <div className="node-tree-children">
          {children.map((c) => (
            <NodeTreeRow
              key={c.id}
              mapId={mapId}
              node={c}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onPan={onPan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Derive pan coordinates from a GeoJSON geometry ──────────────────────────
// Returns Leaflet's [lat, lng] tuple. For LineString/Polygon we pick the
// first vertex — predictable and cheap. (Computing centroids would be
// nicer but isn't worth the complexity for this ticket.)

function derivePanCoords(g: GeoJsonGeometry): [number, number] | null {
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates as [number, number];
    return [lat, lng];
  }
  if (g.type === 'LineString') {
    const first = (g.coordinates as [number, number][])[0];
    return first ? [first[1], first[0]] : null;
  }
  if (g.type === 'Polygon') {
    const first = (g.coordinates as [number, number][][])[0]?.[0];
    return first ? [first[1], first[0]] : null;
  }
  return null;
}
