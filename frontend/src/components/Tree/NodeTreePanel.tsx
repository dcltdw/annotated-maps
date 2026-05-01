import { useEffect, useState } from 'react';
import { nodesService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { NodeRecord, GeoJsonGeometry, CreateNodeRequest } from '@/types';

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
  // refreshKey is bumped after a successful node create. Both the root
  // listing here and each NodeTreeRow's children listing watch it; a
  // bump triggers a re-fetch of root nodes and (if the row is expanded)
  // the row's children. Collapsed rows just clear their cached children
  // so the next expand fetches fresh.
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

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
  }, [mapId, refreshKey]);

  return (
    <aside className="node-tree-panel">
      <div className="node-tree-header">
        <h3>Nodes</h3>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          + Node
        </button>
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
            refreshKey={refreshKey}
          />
        ))}
      </div>
      {showCreate && (
        <CreateNodeModal
          mapId={mapId}
          onClose={() => setShowCreate(false)}
          onCreated={(newId) => {
            setShowCreate(false);
            setRefreshKey((k) => k + 1);
            onSelectNode(newId);
          }}
        />
      )}
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
  refreshKey: number;
}

function NodeTreeRow({
  mapId,
  node,
  depth,
  selectedNodeId,
  onSelect,
  onPan,
  refreshKey,
}: NodeTreeRowProps) {
  // `children === null` means we haven't fetched yet; `[]` means we have
  // and there are none. The toggle is shown until we know for certain
  // the node is a leaf (then it's a placeholder for layout consistency).
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<NodeRecord[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);

  // When the panel signals a refresh (after a node create), invalidate
  // this row's cached children. If we're expanded, refetch immediately
  // so a newly-added child shows up. If we're collapsed, just clear
  // the cache so the next expand fetches fresh.
  useEffect(() => {
    if (refreshKey === 0) return; // initial render, nothing to refresh
    if (expanded) {
      let cancelled = false;
      setLoadingChildren(true);
      nodesService
        .listChildren(mapId, node.id)
        .then((cs) => { if (!cancelled) setChildren(cs); })
        .catch(() => { if (!cancelled) setChildrenError('Failed to refresh children.'); })
        .finally(() => { if (!cancelled) setLoadingChildren(false); });
      return () => { cancelled = true; };
    } else {
      setChildren(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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
        {node.visibilityOverride && (
          <span
            className="node-tree-override-icon"
            title="Visibility overridden — explicit set on this node"
            aria-label="Visibility overridden"
          >
            🔒
          </span>
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
              refreshKey={refreshKey}
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

// ─── Create-node modal (#150) ────────────────────────────────────────────────
// Minimum-viable node creator: name (required), description, parent
// (optional; flat list of all nodes on this map), color. Geometry creation
// is deliberately deferred — nodes can be created without geometry, and a
// future "draw toolbar" ticket can add point/line/polygon placement from
// the map view. This unblocks the basic UX of "create a fresh map → put
// some places on it" entirely from the UI.

interface CreateNodeModalProps {
  mapId: number;
  onClose: () => void;
  onCreated: (newNodeId: number) => void;
}

function CreateNodeModal({ mapId, onClose, onCreated }: CreateNodeModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [color, setColor] = useState('');
  const [allNodes, setAllNodes] = useState<NodeRecord[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flat list of all nodes for the parent picker. Top-level nodes
  // appear with no indent prefix; deeper nodes get prefixed by their
  // depth — see depthPrefix() below. The list is fetched once when
  // the modal opens; the typical map has <100 nodes so a flat fetch
  // is cheap, and it sidesteps having to walk the tree to build a
  // selectable list.
  useEffect(() => {
    let cancelled = false;
    nodesService
      .listNodes(mapId)
      .then((ns) => { if (!cancelled) setAllNodes(ns); })
      .catch(() => { if (!cancelled) setAllNodes([]); })
      .finally(() => { if (!cancelled) setLoadingNodes(false); });
    return () => { cancelled = true; };
  }, [mapId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const req: CreateNodeRequest = { name: name.trim() };
      if (description.trim()) req.description = description.trim();
      if (parentId) req.parentId = Number(parentId);
      if (color.trim()) req.color = color.trim();
      const created = await nodesService.createNode(mapId, req);
      onCreated(created.id);
    } catch (err) {
      setError(extractApiError(err, 'Failed to create node.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Node</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="new-node-name">Name</label>
            <input
              id="new-node-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="The Old Mill, Yangseong, …"
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-node-description">Description</label>
            <textarea
              id="new-node-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-node-parent">Parent (optional)</label>
            <select
              id="new-node-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={saving || loadingNodes}
            >
              <option value="">— Top level —</option>
              {allNodes.map((n) => (
                <option key={n.id} value={String(n.id)}>{n.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="new-node-color">Color (optional)</label>
            <input
              id="new-node-color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#cc0000 or red"
              disabled={saving}
            />
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !name.trim()}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
