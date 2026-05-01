import { useEffect, useState } from 'react';
import { nodesService, notesService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type {
  NodeRecord,
  GeoJsonGeometry,
  CreateNodeRequest,
  CoordinateSystem,
} from '@/types';

// User-facing copy convention (#150 follow-up): the data model calls these
// "nodes" (and that term is preserved in code, schemas, API, comments,
// CSS class names) but UI text uses "location" — "node" is graph-theory
// jargon that doesn't read naturally to someone annotating a map. This
// component is the primary surface where that translation happens.

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
  coordinateSystem: CoordinateSystem;
  selectedNodeId: number | null;
  onSelectNode: (nodeId: number) => void;
  onPanToNode: (coords: [number, number]) => void;
}

export function NodeTreePanel({
  mapId,
  coordinateSystem,
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
        if (!cancelled) setError('Failed to load locations.');
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
        <h3>Locations</h3>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          + Location
        </button>
      </div>
      {loading && <div className="node-tree-state">Loading…</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && rootNodes.length === 0 && (
        <div className="node-tree-state">No locations on this map yet.</div>
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
          coordinateSystem={coordinateSystem}
          onClose={() => setShowCreate(false)}
          onCreated={(newId, panCoords) => {
            setShowCreate(false);
            setRefreshKey((k) => k + 1);
            onSelectNode(newId);
            // If the user supplied coordinates, also pan the map to the
            // new node so the marker is visible immediately. Mirrors what
            // happens when the user clicks an existing node row.
            if (panCoords) onPanToNode(panCoords);
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
            title="Visibility overridden — explicit set on this location"
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
          aria-label="Location actions"
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
  coordinateSystem: CoordinateSystem;
  onClose: () => void;
  // panCoords (Leaflet [lat,lng] for wgs84, [y,x] for pixel/blank per
  // the existing onPanToNode contract) is supplied only when the user
  // entered coordinates. Caller uses it to pan the map to the new
  // marker; passes nothing for tree-only nodes.
  onCreated: (newNodeId: number, panCoords?: [number, number]) => void;
}

function CreateNodeModal({
  mapId,
  coordinateSystem,
  onClose,
  onCreated,
}: CreateNodeModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [color, setColor] = useState('');
  // Coordinates are kept as raw strings so the user can leave them empty
  // (= no geometry, tree-only location) without us interpreting "0" as
  // "0,0". For wgs84 the pair is (lat, lng); for pixel/blank it's (x, y).
  const [coord1, setCoord1] = useState('');
  const [coord2, setCoord2] = useState('');
  // Optional first note (option B from the #150 design discussion). If
  // the user fills this in, after the location is created we post a
  // note to it as part of the same modal close. Common case ("annotate
  // this place with one paragraph") becomes one form, one click.
  const [firstNote, setFirstNote] = useState('');
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

  // Both inputs must be filled (or both empty). Half-filled = treat as
  // tree-only and silently ignore — the validation message would clutter
  // the form and the backend has no half-coordinate semantics anyway.
  const c1Trim = coord1.trim();
  const c2Trim = coord2.trim();
  const bothCoordsProvided = c1Trim !== '' && c2Trim !== '';
  const c1Num = bothCoordsProvided ? Number(c1Trim) : NaN;
  const c2Num = bothCoordsProvided ? Number(c2Trim) : NaN;
  const coordsValid = bothCoordsProvided
    && Number.isFinite(c1Num) && Number.isFinite(c2Num);
  const coordsInvalid = bothCoordsProvided && !coordsValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (coordsInvalid) {
      setError('Coordinates must be numeric, or leave both fields empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const req: CreateNodeRequest = { name: name.trim() };
      if (description.trim()) req.description = description.trim();
      if (parentId) req.parentId = Number(parentId);
      if (color.trim()) req.color = color.trim();

      // GeoJSON coordinate ordering is type-dependent:
      //   wgs84 → [lng, lat] (GeoJSON's standard horizontal-then-vertical)
      //   pixel/blank → [x, y] (Leaflet CRS.Simple maps these directly)
      // Both forms collapse to a Point geometry. The corresponding
      // pan-coords for the existing onPanToNode contract are:
      //   wgs84 → [lat, lng] (Leaflet's [lat, lng] tuple)
      //   pixel/blank → [y, x] (Leaflet's coord swap on CRS.Simple)
      let panCoords: [number, number] | undefined;
      if (coordsValid) {
        if (coordinateSystem.type === 'wgs84') {
          // c1 = lat, c2 = lng
          req.geoJson = { type: 'Point', coordinates: [c2Num, c1Num] };
          panCoords = [c1Num, c2Num];
        } else {
          // c1 = x, c2 = y for both pixel and blank
          req.geoJson = { type: 'Point', coordinates: [c1Num, c2Num] };
          panCoords = [c2Num, c1Num];
        }
      }

      const created = await nodesService.createNode(mapId, req);

      // Optional first-note: if the user filled in the textarea, post
      // it as a note attached to the just-created location. Failure
      // here is treated as non-fatal — the location IS created, and
      // the user can add the note manually from the detail panel —
      // but we surface the error so it isn't silently swallowed.
      const noteText = firstNote.trim();
      if (noteText) {
        try {
          await notesService.createNote(mapId, created.id, { text: noteText });
        } catch (noteErr) {
          window.alert(
            `Location was created, but the first note failed to save: ` +
            `${extractApiError(noteErr, 'unknown error')}. ` +
            `You can add the note manually from the detail panel.`,
          );
        }
      }

      onCreated(created.id, panCoords);
    } catch (err) {
      setError(extractApiError(err, 'Failed to create location.'));
    } finally {
      setSaving(false);
    }
  };

  // Coordinate-input labels and placeholders depend on the map's type.
  const coordLabels = coordinateSystem.type === 'wgs84'
    ? { c1: 'Latitude', c2: 'Longitude', c1ph: 'e.g. 42.0', c2ph: 'e.g. -74.4' }
    : { c1: 'X', c2: 'Y', c1ph: '0', c2ph: '0' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Location</h2>
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
          <fieldset className="form-coord-pair">
            <legend>Location (optional)</legend>
            <small className="form-coord-hint">
              Fill both to place a marker on the map; leave both empty for
              a tree-only node.
            </small>
            <div className="form-coord-inputs">
              <div className="form-group">
                <label htmlFor="new-node-coord1">{coordLabels.c1}</label>
                <input
                  id="new-node-coord1"
                  type="number"
                  step="any"
                  value={coord1}
                  onChange={(e) => setCoord1(e.target.value)}
                  placeholder={coordLabels.c1ph}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-node-coord2">{coordLabels.c2}</label>
                <input
                  id="new-node-coord2"
                  type="number"
                  step="any"
                  value={coord2}
                  onChange={(e) => setCoord2(e.target.value)}
                  placeholder={coordLabels.c2ph}
                  disabled={saving}
                />
              </div>
            </div>
          </fieldset>
          <div className="form-group">
            <label htmlFor="new-node-first-note">First note (optional)</label>
            <textarea
              id="new-node-first-note"
              value={firstNote}
              onChange={(e) => setFirstNote(e.target.value)}
              placeholder="A short note attached to this location. Leave empty to skip."
              rows={2}
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
