import { useEffect, useState } from 'react';
import { nodesService, notesService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type {
  NodeRecord,
  GeoJsonGeometry,
  CreateNodeRequest,
  UpdateNodeRequest,
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
  // Called when a location is deleted. The parent (MapDetailPage) uses
  // this to clear its `selectedNodeId` if the deleted location was
  // the selected one — the detail panel needs to fall back to its
  // empty state instead of trying to render a node that no longer
  // exists.
  onLocationDeleted?: (nodeId: number) => void;
}

export function NodeTreePanel({
  mapId,
  coordinateSystem,
  selectedNodeId,
  onSelectNode,
  onPanToNode,
  onLocationDeleted,
}: NodeTreePanelProps) {
  const [rootNodes, setRootNodes] = useState<NodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // refreshKey is bumped after a successful create / edit / delete.
  // Both the root listing here and each NodeTreeRow's children listing
  // watch it; a bump triggers a re-fetch of root nodes and (if the row
  // is expanded) the row's children. Collapsed rows just clear their
  // cached children so the next expand fetches fresh.
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  // Edit-modal state (#158): when non-null, the modal renders in edit
  // mode pre-populated with this node's fields.
  const [editingNode, setEditingNode] = useState<NodeRecord | null>(null);

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
            onEdit={setEditingNode}
            onDelete={async (n) => {
              if (!window.confirm(`Delete location "${n.name}"?`)) return;
              try {
                await nodesService.deleteNode(mapId, n.id);
                setRefreshKey((k) => k + 1);
                if (selectedNodeId === n.id && onLocationDeleted) {
                  onLocationDeleted(n.id);
                }
              } catch (e) {
                window.alert(extractApiError(e, 'Failed to delete location.'));
              }
            }}
          />
        ))}
      </div>
      {(showCreate || editingNode) && (
        <LocationFormModal
          mode={editingNode ? 'edit' : 'create'}
          mapId={mapId}
          coordinateSystem={coordinateSystem}
          existingNode={editingNode ?? undefined}
          onClose={() => {
            setShowCreate(false);
            setEditingNode(null);
          }}
          onSaved={(savedId, panCoords) => {
            setShowCreate(false);
            setEditingNode(null);
            setRefreshKey((k) => k + 1);
            onSelectNode(savedId);
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
  onEdit: (node: NodeRecord) => void;
  onDelete: (node: NodeRecord) => void;
}

function NodeTreeRow({
  mapId,
  node,
  depth,
  selectedNodeId,
  onSelect,
  onPan,
  refreshKey,
  onEdit,
  onDelete,
}: NodeTreeRowProps) {
  // Per-row dropdown state (#158). Toggled by the ⋯ button; closed
  // automatically on Edit/Delete dispatch and on click-outside.
  const [menuOpen, setMenuOpen] = useState(false);
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
        {/* Per-row actions menu (#158): Edit + Delete. Move/copy still
            future per #90 / #100. The menu is intentionally simple — a
            controlled dropdown closed on click-outside via the wrapper's
            onBlur (the menu div is focusable so blur fires when focus
            leaves the dropdown subtree). */}
        <div
          className="node-tree-menu-wrapper"
          tabIndex={-1}
          onBlur={(e) => {
            // Only close if focus is leaving the subtree entirely.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setMenuOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="node-tree-menu"
            aria-label="Location actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((m) => !m);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="node-tree-menu-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                className="node-tree-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit(node);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                className="node-tree-menu-item node-tree-menu-item-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(node);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
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
              onEdit={onEdit}
              onDelete={onDelete}
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

// ─── Location form modal (#150 + #158) ──────────────────────────────────────
// Single component for both create and edit. Mode-specific behavior:
//
//   create (#150):
//     - blank fields, optional coordinates inputs (constructs a Point
//       geometry with type-specific axis ordering), optional first-note
//       textarea (creates the note as part of the same submit if filled)
//     - POST /maps/{mid}/nodes
//
//   edit (#158):
//     - fields pre-populated from the existing node
//     - coordinate inputs hidden (edit-geometry deferred to the
//       click-on-map / draw-toolbar ticket #153 — modal-based geometry
//       editing would duplicate the pattern coming there)
//     - first-note textarea hidden (only relevant for fresh locations;
//       the detail panel's Notes section handles further note CRUD)
//     - parent picker omits the location being edited (and its
//       descendants — a node can't become its own ancestor)
//     - PUT /maps/{mid}/nodes/{nid} with only changed fields
//
// Both modes share the field layout, the parent picker fetch, and the
// modal scaffolding.

interface LocationFormModalProps {
  mode: 'create' | 'edit';
  mapId: number;
  coordinateSystem: CoordinateSystem;
  /** Required when mode === 'edit'; ignored when mode === 'create'. */
  existingNode?: NodeRecord;
  onClose: () => void;
  // panCoords is supplied only on create when the user entered fresh
  // coordinates. Caller uses it to pan the map. On edit, no pan happens
  // here — geometry is preserved as-is.
  onSaved: (savedNodeId: number, panCoords?: [number, number]) => void;
}

function LocationFormModal({
  mode,
  mapId,
  coordinateSystem,
  existingNode,
  onClose,
  onSaved,
}: LocationFormModalProps) {
  const [name, setName] = useState(existingNode?.name ?? '');
  const [description, setDescription] = useState(existingNode?.description ?? '');
  const [parentId, setParentId] = useState<string>(
    existingNode?.parentId != null ? String(existingNode.parentId) : '',
  );
  const [color, setColor] = useState(existingNode?.color ?? '');
  // Coordinates only apply on create — see scope note in the component
  // header. On edit they're hidden + unused.
  const [coord1, setCoord1] = useState('');
  const [coord2, setCoord2] = useState('');
  // First note only applies on create — see scope note.
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
    if (mode === 'create' && coordsInvalid) {
      setError('Coordinates must be numeric, or leave both fields empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (mode === 'edit' && existingNode) {
        // Build a partial update: only include fields that actually
        // changed, so we don't accidentally overwrite something the
        // backend handled differently (e.g. a parent picker change vs
        // an unchanged blank parent).
        const req: UpdateNodeRequest = {};
        if (name.trim() !== existingNode.name) req.name = name.trim();
        if (description.trim() !== (existingNode.description ?? '')) {
          req.description = description.trim();
        }
        if (color.trim() !== (existingNode.color ?? '')) {
          req.color = color.trim();
        }
        // parentId in the form is a string; backend expects number or
        // null. Empty string in the form means "Top level" (parentId
        // = null) — but the schema's UpdateNodeRequest doesn't carry
        // parentId (re-parenting is a separate move endpoint, #90),
        // so we can't actually change parent via this path. Keep the
        // dropdown for symmetry with create, but skip in the diff —
        // a future ticket can wire move/copy through this same UI.

        if (Object.keys(req).length === 0) {
          // Nothing changed — close without making a network call.
          onSaved(existingNode.id);
          return;
        }
        await nodesService.updateNode(mapId, existingNode.id, req);
        onSaved(existingNode.id);
        return;
      }

      // mode === 'create' below.
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

      onSaved(created.id, panCoords);
    } catch (err) {
      setError(extractApiError(err, mode === 'edit' ? 'Failed to save location.' : 'Failed to create location.'));
    } finally {
      setSaving(false);
    }
  };

  // Coordinate-input labels and placeholders depend on the map's type.
  const coordLabels = coordinateSystem.type === 'wgs84'
    ? { c1: 'Latitude', c2: 'Longitude', c1ph: 'e.g. 42.0', c2ph: 'e.g. -74.4' }
    : { c1: 'X', c2: 'Y', c1ph: '0', c2ph: '0' };

  // On edit, exclude the node being edited from the parent picker —
  // a node can't become its own ancestor. Excluding direct descendants
  // would also be ideal, but requires a tree walk and the backend
  // would catch the cycle anyway. v1 covers the common case.
  const parentOptions = mode === 'edit' && existingNode
    ? allNodes.filter((n) => n.id !== existingNode.id)
    : allNodes;

  const isEdit = mode === 'edit';
  const idPrefix = isEdit ? 'edit-node' : 'new-node';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isEdit ? 'Edit Location' : 'New Location'}</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor={`${idPrefix}-name`}>Name</label>
            <input
              id={`${idPrefix}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="The Old Mill, Yangseong, …"
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-description`}>Description</label>
            <textarea
              id={`${idPrefix}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-parent`}>
              Parent {isEdit ? '(read-only — re-parent via move, future ticket)' : '(optional)'}
            </label>
            <select
              id={`${idPrefix}-parent`}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={saving || loadingNodes || isEdit}
            >
              <option value="">— Top level —</option>
              {parentOptions.map((n) => (
                <option key={n.id} value={String(n.id)}>{n.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={`${idPrefix}-color`}>Color (optional)</label>
            <input
              id={`${idPrefix}-color`}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#cc0000 or red"
              disabled={saving}
            />
          </div>
          {!isEdit && (
            <fieldset className="form-coord-pair">
              <legend>Location (optional)</legend>
              <small className="form-coord-hint">
                Fill both to place a marker on the map; leave both empty for
                a tree-only node.
              </small>
              <div className="form-coord-inputs">
                <div className="form-group">
                  <label htmlFor={`${idPrefix}-coord1`}>{coordLabels.c1}</label>
                  <input
                    id={`${idPrefix}-coord1`}
                    type="number"
                    step="any"
                    value={coord1}
                    onChange={(e) => setCoord1(e.target.value)}
                    placeholder={coordLabels.c1ph}
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`${idPrefix}-coord2`}>{coordLabels.c2}</label>
                  <input
                    id={`${idPrefix}-coord2`}
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
          )}
          {!isEdit && (
            <div className="form-group">
              <label htmlFor={`${idPrefix}-first-note`}>First note (optional)</label>
              <textarea
                id={`${idPrefix}-first-note`}
                value={firstNote}
                onChange={(e) => setFirstNote(e.target.value)}
                placeholder="A short note attached to this location. Leave empty to skip."
                rows={2}
                disabled={saving}
              />
            </div>
          )}
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
              {saving ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
