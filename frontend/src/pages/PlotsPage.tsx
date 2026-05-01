import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  plotsService,
  mapsService,
  nodesService,
  notesService,
} from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type {
  PlotRecord,
  PlotMembers,
  PlotNodeMember,
  PlotNoteMember,
  CreatePlotRequest,
  UpdatePlotRequest,
  MapRecord,
  NodeRecord,
  NoteRecord,
} from '@/api/schemas';

// Phase 2g.j (#95): Plots admin page. Plots are tenant-scoped narrative
// groupings tying together nodes + notes across maps; this page surfaces
// the CRUD + member management the backend has had since #88. Modeled on
// VisibilityGroupsPage's collapsible-row pattern — read-many + inline
// member panel + modal for create/edit.
//
// Add-member UX is a two-step picker (map → node, or map → node → note)
// rather than a tenant-wide name search. The backend doesn't expose a
// cross-map search endpoint, and synthesizing one client-side would mean
// fetching every map's full node list on first render. The picker keeps
// the request shape narrow — one map's worth of nodes/notes at a time —
// at the cost of a couple extra clicks. Cross-map search is the natural
// follow-up if this becomes painful.
//
// Click-to-jump: each member row links to
//   /tenants/{tid}/maps/{mid}?node={nodeId}
// MapDetailPage reads the `node` query param on mount and pre-selects.
// For note members the link points at the note's parent node, since the
// note shows up in NodeDetailPanel's notes list — selecting the note
// itself from a query param would need NodeDetailPanel changes that are
// out of scope for this PR.

export function PlotsPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const tenantIdNum = Number(tenantId);

  const [plots, setPlots] = useState<PlotRecord[]>([]);
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPlot, setEditingPlot] = useState<PlotRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reloadPlots = useCallback(async () => {
    try {
      const fresh = await plotsService.listPlots(tenantIdNum);
      setPlots(fresh);
    } catch (e) {
      setError(extractApiError(e, 'Failed to load plots.'));
    }
  }, [tenantIdNum]);

  useEffect(() => {
    if (!tenantIdNum) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      reloadPlots(),
      // Maps feed the add-member pickers. Page-size 100 covers the
      // common case; if a tenant has more, the picker shows the first
      // page. A future ticket can add pagination once we hit that.
      mapsService
        .listMaps(1, 100, tenantIdNum)
        .then((m) => { if (!cancelled) setMaps(m.data); })
        .catch(() => { if (!cancelled) setMaps([]); }),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tenantIdNum, reloadPlots]);

  if (!tenantIdNum) {
    return <div className="page-error">Missing tenant in route.</div>;
  }
  if (loading) return <div className="page-loading">Loading plots…</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Plots</h1>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New Plot
          </button>
          <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
            ← Back to maps
          </Link>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {plots.length === 0 ? (
        <div className="empty-state">
          <p>No plots yet.</p>
        </div>
      ) : (
        <ul className="plot-list">
          {plots.map((p) => (
            <li key={p.id}>
              <PlotRow
                plot={p}
                tenantId={tenantIdNum}
                maps={maps}
                onEdit={() => setEditingPlot(p)}
                onChange={reloadPlots}
              />
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <PlotFormModal
          mode="create"
          tenantId={tenantIdNum}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await reloadPlots();
          }}
        />
      )}
      {editingPlot && (
        <PlotFormModal
          mode="edit"
          tenantId={tenantIdNum}
          plot={editingPlot}
          onClose={() => setEditingPlot(null)}
          onSaved={async () => {
            setEditingPlot(null);
            await reloadPlots();
          }}
        />
      )}
    </div>
  );
}

// ─── Per-plot row (collapsible, with members panel inside) ───────────────────

interface PlotRowProps {
  plot: PlotRecord;
  tenantId: number;
  maps: MapRecord[];
  onEdit: () => void;
  onChange: () => Promise<void> | void;
}

function PlotRow({ plot, tenantId, maps, onEdit, onChange }: PlotRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<PlotMembers>({ nodes: [], notes: [] });
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const memberCount = members.nodes.length + members.notes.length;

  const reloadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMemberError(null);
    try {
      const fresh = await plotsService.listMembers(plot.id, tenantId);
      setMembers(fresh);
    } catch (e) {
      setMemberError(extractApiError(e, 'Failed to load plot members.'));
    } finally {
      setLoadingMembers(false);
    }
  }, [plot.id, tenantId]);

  const handleToggle = async () => {
    if (!expanded && memberCount === 0 && !loadingMembers) {
      await reloadMembers();
    }
    setExpanded((e) => !e);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete plot "${plot.name}"?`)) return;
    try {
      await plotsService.deletePlot(plot.id, tenantId);
      await onChange();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to delete plot.'));
    }
  };

  const handleRemoveNode = async (nodeId: number) => {
    try {
      await plotsService.removeNode(plot.id, nodeId, tenantId);
      await reloadMembers();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to remove node.'));
    }
  };

  const handleRemoveNote = async (noteId: number) => {
    try {
      await plotsService.removeNote(plot.id, noteId, tenantId);
      await reloadMembers();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to remove note.'));
    }
  };

  // Resolve map-id → map title for member-row breadcrumbs. Members can
  // reference maps the caller doesn't have direct access to (e.g. shared
  // by another tenant member); fall back to the id in that case.
  const mapTitle = (mapId: number): string => {
    const m = maps.find((mm) => mm.id === mapId);
    return m?.title ?? `Map #${mapId}`;
  };

  return (
    <article className="plot-row">
      <header className="plot-header" onClick={handleToggle}>
        <button
          type="button"
          className="plot-toggle"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <h2 className="plot-name">{plot.name}</h2>
        {expanded && (
          <span className="plot-count">
            {loadingMembers
              ? '…'
              : `${memberCount} member${memberCount === 1 ? '' : 's'}`}
          </span>
        )}
        <div className="plot-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          >
            Delete
          </button>
        </div>
      </header>
      {plot.description && <p className="plot-description">{plot.description}</p>}
      {expanded && (
        <div className="plot-body">
          {memberError && <div className="alert alert-error">{memberError}</div>}

          <section className="plot-section">
            <h3>Locations ({members.nodes.length})</h3>
            {members.nodes.length === 0 ? (
              <p className="plot-empty">No locations attached.</p>
            ) : (
              <ul className="plot-member-list">
                {members.nodes.map((n) => (
                  <PlotNodeRow
                    key={n.id}
                    node={n}
                    tenantId={tenantId}
                    mapTitle={mapTitle(n.mapId)}
                    onRemove={() => handleRemoveNode(n.id)}
                  />
                ))}
              </ul>
            )}
            <AddNodePicker
              plotId={plot.id}
              tenantId={tenantId}
              maps={maps}
              currentNodeIds={new Set(members.nodes.map((n) => n.id))}
              onAdded={reloadMembers}
            />
          </section>

          <section className="plot-section">
            <h3>Notes ({members.notes.length})</h3>
            {members.notes.length === 0 ? (
              <p className="plot-empty">No notes attached.</p>
            ) : (
              <ul className="plot-member-list">
                {members.notes.map((n) => (
                  <PlotNoteRow
                    key={n.id}
                    note={n}
                    tenantId={tenantId}
                    mapTitle={mapTitle(n.mapId)}
                    onRemove={() => handleRemoveNote(n.id)}
                  />
                ))}
              </ul>
            )}
            <AddNotePicker
              plotId={plot.id}
              tenantId={tenantId}
              maps={maps}
              currentNoteIds={new Set(members.notes.map((n) => n.id))}
              onAdded={reloadMembers}
            />
          </section>
        </div>
      )}
    </article>
  );
}

// ─── Per-member rows ─────────────────────────────────────────────────────────

interface PlotNodeRowProps {
  node: PlotNodeMember;
  tenantId: number;
  mapTitle: string;
  onRemove: () => void;
}

function PlotNodeRow({ node, tenantId, mapTitle, onRemove }: PlotNodeRowProps) {
  return (
    <li className="plot-member-row">
      <Link
        to={`/tenants/${tenantId}/maps/${node.mapId}?node=${node.id}`}
        className="plot-member-link"
      >
        <span className="plot-member-name">{node.name}</span>
        <span className="plot-member-map">in {mapTitle}</span>
      </Link>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

interface PlotNoteRowProps {
  note: PlotNoteMember;
  tenantId: number;
  mapTitle: string;
  onRemove: () => void;
}

function PlotNoteRow({ note, tenantId, mapTitle, onRemove }: PlotNoteRowProps) {
  // Note links land on the note's parent node — NodeDetailPanel renders
  // the node's notes inline, so the user sees the right one in context.
  return (
    <li className="plot-member-row">
      <Link
        to={`/tenants/${tenantId}/maps/${note.mapId}?node=${note.nodeId}`}
        className="plot-member-link"
      >
        <span className="plot-member-name">
          {note.title || '(untitled note)'}
          {note.pinned && <span className="plot-member-pin"> 📌</span>}
        </span>
        <span className="plot-member-map">in {mapTitle}</span>
      </Link>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

// ─── Add-node picker ─────────────────────────────────────────────────────────

interface AddNodePickerProps {
  plotId: number;
  tenantId: number;
  maps: MapRecord[];
  currentNodeIds: Set<number>;
  onAdded: () => Promise<void> | void;
}

function AddNodePicker({
  plotId,
  tenantId,
  maps,
  currentNodeIds,
  onAdded,
}: AddNodePickerProps) {
  const [selectedMapId, setSelectedMapId] = useState<string>('');
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMapId) {
      setNodes([]);
      return;
    }
    let cancelled = false;
    setLoadingNodes(true);
    nodesService
      .listNodes(Number(selectedMapId), undefined, tenantId)
      .then((ns) => { if (!cancelled) setNodes(ns); })
      .catch(() => { if (!cancelled) setNodes([]); })
      .finally(() => { if (!cancelled) setLoadingNodes(false); });
    return () => { cancelled = true; };
  }, [selectedMapId, tenantId]);

  const eligibleNodes = nodes.filter((n) => !currentNodeIds.has(n.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNodeId) return;
    setError(null);
    setSaving(true);
    try {
      await plotsService.addNode(plotId, Number(selectedNodeId), tenantId);
      setSelectedNodeId('');
      await onAdded();
    } catch (err) {
      setError(extractApiError(err, 'Failed to add node.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="plot-add-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error">{error}</div>}
      <select
        value={selectedMapId}
        onChange={(e) => {
          setSelectedMapId(e.target.value);
          setSelectedNodeId('');
        }}
        disabled={saving}
      >
        <option value="">Pick a map…</option>
        {maps.map((m) => (
          <option key={m.id} value={String(m.id)}>{m.title}</option>
        ))}
      </select>
      <select
        value={selectedNodeId}
        onChange={(e) => setSelectedNodeId(e.target.value)}
        disabled={saving || !selectedMapId || loadingNodes}
      >
        <option value="">
          {!selectedMapId
            ? 'Pick a map first'
            : loadingNodes
              ? 'Loading nodes…'
              : eligibleNodes.length === 0
                ? 'No eligible nodes'
                : 'Pick a location…'}
        </option>
        {eligibleNodes.map((n) => (
          <option key={n.id} value={String(n.id)}>{n.name}</option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={saving || !selectedNodeId}
      >
        {saving ? 'Adding…' : 'Add location'}
      </button>
    </form>
  );
}

// ─── Add-note picker ─────────────────────────────────────────────────────────

interface AddNotePickerProps {
  plotId: number;
  tenantId: number;
  maps: MapRecord[];
  currentNoteIds: Set<number>;
  onAdded: () => Promise<void> | void;
}

function AddNotePicker({
  plotId,
  tenantId,
  maps,
  currentNoteIds,
  onAdded,
}: AddNotePickerProps) {
  const [selectedMapId, setSelectedMapId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMapId) {
      setNodes([]);
      return;
    }
    let cancelled = false;
    setLoadingNodes(true);
    nodesService
      .listNodes(Number(selectedMapId), undefined, tenantId)
      .then((ns) => { if (!cancelled) setNodes(ns); })
      .catch(() => { if (!cancelled) setNodes([]); })
      .finally(() => { if (!cancelled) setLoadingNodes(false); });
    return () => { cancelled = true; };
  }, [selectedMapId, tenantId]);

  useEffect(() => {
    if (!selectedMapId || !selectedNodeId) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setLoadingNotes(true);
    notesService
      .listNotesForNode(Number(selectedMapId), Number(selectedNodeId), tenantId)
      .then((ns) => { if (!cancelled) setNotes(ns); })
      .catch(() => { if (!cancelled) setNotes([]); })
      .finally(() => { if (!cancelled) setLoadingNotes(false); });
    return () => { cancelled = true; };
  }, [selectedMapId, selectedNodeId, tenantId]);

  const eligibleNotes = notes.filter((n) => !currentNoteIds.has(n.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNoteId) return;
    setError(null);
    setSaving(true);
    try {
      await plotsService.addNote(plotId, Number(selectedNoteId), tenantId);
      setSelectedNoteId('');
      await onAdded();
    } catch (err) {
      setError(extractApiError(err, 'Failed to add note.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="plot-add-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error">{error}</div>}
      <select
        value={selectedMapId}
        onChange={(e) => {
          setSelectedMapId(e.target.value);
          setSelectedNodeId('');
          setSelectedNoteId('');
        }}
        disabled={saving}
      >
        <option value="">Pick a map…</option>
        {maps.map((m) => (
          <option key={m.id} value={String(m.id)}>{m.title}</option>
        ))}
      </select>
      <select
        value={selectedNodeId}
        onChange={(e) => {
          setSelectedNodeId(e.target.value);
          setSelectedNoteId('');
        }}
        disabled={saving || !selectedMapId || loadingNodes}
      >
        <option value="">
          {!selectedMapId
            ? 'Pick a map first'
            : loadingNodes
              ? 'Loading nodes…'
              : 'Pick a location…'}
        </option>
        {nodes.map((n) => (
          <option key={n.id} value={String(n.id)}>{n.name}</option>
        ))}
      </select>
      <select
        value={selectedNoteId}
        onChange={(e) => setSelectedNoteId(e.target.value)}
        disabled={saving || !selectedNodeId || loadingNotes}
      >
        <option value="">
          {!selectedNodeId
            ? 'Pick a location first'
            : loadingNotes
              ? 'Loading notes…'
              : eligibleNotes.length === 0
                ? 'No eligible notes'
                : 'Pick a note…'}
        </option>
        {eligibleNotes.map((n) => (
          <option key={n.id} value={String(n.id)}>
            {n.title || '(untitled)'}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={saving || !selectedNoteId}
      >
        {saving ? 'Adding…' : 'Add note'}
      </button>
    </form>
  );
}

// ─── Create / edit modal ─────────────────────────────────────────────────────

interface PlotFormModalProps {
  mode: 'create' | 'edit';
  tenantId: number;
  plot?: PlotRecord;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function PlotFormModal({ mode, tenantId, plot, onClose, onSaved }: PlotFormModalProps) {
  const [name, setName] = useState(plot?.name ?? '');
  const [description, setDescription] = useState(plot?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === 'create') {
        const req: CreatePlotRequest = { name };
        if (description) req.description = description;
        await plotsService.createPlot(req, tenantId);
      } else if (plot) {
        const req: UpdatePlotRequest = {};
        if (name !== plot.name) req.name = name;
        if (description !== plot.description) req.description = description;
        await plotsService.updatePlot(plot.id, req, tenantId);
      }
      await onSaved();
    } catch (err) {
      setError(extractApiError(err, `Failed to ${mode} plot.`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'create' ? 'New Plot' : 'Edit Plot'}</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="plot-name">Name</label>
            <input
              id="plot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="The Heist, Act II, …"
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="plot-description">Description</label>
            <textarea
              id="plot-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
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
              disabled={saving || !name}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
