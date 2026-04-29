import { useCallback, useEffect, useState } from 'react';
import { nodesService, notesService, nodeMediaService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type {
  NodeRecord,
  NodeMediaRecord,
  NoteRecord,
  CreateNoteRequest,
  UpdateNoteRequest,
} from '@/types';

// NodeDetailPanel — Phase 2g.e (#103). Lives below the tree+map layout
// in MapDetailPage. When a node is selected (in either the tree or by
// clicking a layer on the map), this panel shows:
//   - heading: name
//   - parent link (clickable; calls onSelectNode for navigation)
//   - description
//   - color indicator
//   - media list (image thumbnails + link list)
//   - inline notes CRUD (list pinned-first, create/edit/delete)
//
// Empty state when nothing is selected.

interface NodeDetailPanelProps {
  mapId: number;
  selectedNodeId: number | null;
  onSelectNode: (nodeId: number) => void;
}

export function NodeDetailPanel({
  mapId,
  selectedNodeId,
  onSelectNode,
}: NodeDetailPanelProps) {
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [parent, setParent] = useState<NodeRecord | null>(null);
  const [media, setMedia] = useState<NodeMediaRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload notes after a CRUD op. Tightly scoped so callers don't need
  // to know the mapId / nodeId separately.
  const reloadNotes = useCallback(async () => {
    if (selectedNodeId === null) return;
    try {
      const fresh = await notesService.listNotesForNode(mapId, selectedNodeId);
      setNotes(fresh);
    } catch (e) {
      setError(extractApiError(e, 'Failed to refresh notes.'));
    }
  }, [mapId, selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId === null) {
      setNode(null);
      setParent(null);
      setMedia([]);
      setNotes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    nodesService
      .getNode(mapId, selectedNodeId)
      .then(async (n) => {
        if (cancelled) return;
        setNode(n);

        // Parent fetch (one-level breadcrumb). The tree panel renders the
        // full chain; this is just the immediate-up navigation hop.
        if (n.parentId !== null) {
          nodesService
            .getNode(mapId, n.parentId)
            .then((p) => { if (!cancelled) setParent(p); })
            .catch(() => { if (!cancelled) setParent(null); });
        } else {
          setParent(null);
        }

        // Media + notes in parallel; failures don't block each other.
        const [m, ns] = await Promise.all([
          nodeMediaService.listMedia(mapId, n.id).catch(() => [] as NodeMediaRecord[]),
          notesService.listNotesForNode(mapId, n.id).catch(() => [] as NoteRecord[]),
        ]);
        if (!cancelled) {
          setMedia(m);
          setNotes(ns);
        }
      })
      .catch((e) => { if (!cancelled) setError(extractApiError(e, 'Failed to load node.')); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [mapId, selectedNodeId]);

  if (selectedNodeId === null) {
    return (
      <section className="node-detail-panel node-detail-empty">
        <p>Select a node to see its details.</p>
      </section>
    );
  }
  if (loading && !node) {
    return <section className="node-detail-panel">Loading node…</section>;
  }
  if (error) {
    return (
      <section className="node-detail-panel">
        <div className="alert alert-error">{error}</div>
      </section>
    );
  }
  if (!node) return null;

  return (
    <section className="node-detail-panel">
      <header className="node-detail-header">
        <div className="node-detail-titlebar">
          {node.color && (
            <span
              className="node-detail-color"
              style={{ background: node.color }}
              aria-hidden="true"
            />
          )}
          <h2>{node.name}</h2>
        </div>
        {parent && (
          <p className="node-detail-breadcrumb">
            in{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => onSelectNode(parent.id)}
            >
              {parent.name}
            </button>
          </p>
        )}
      </header>

      {node.description && (
        <p className="node-detail-description">{node.description}</p>
      )}

      {media.length > 0 && (
        <div className="node-detail-media">
          <h3>Media</h3>
          {media.filter((m) => m.mediaType === 'image').length > 0 && (
            <div className="node-detail-media-images">
              {media
                .filter((m) => m.mediaType === 'image')
                .map((m) => (
                  <img
                    key={m.id}
                    src={m.url}
                    alt={m.caption || node.name}
                    className="node-detail-thumb"
                  />
                ))}
            </div>
          )}
          {media.filter((m) => m.mediaType === 'link').length > 0 && (
            <ul className="node-detail-media-links">
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

      <NotesList
        mapId={mapId}
        nodeId={node.id}
        notes={notes}
        onChange={reloadNotes}
      />
    </section>
  );
}

// ─── Notes list + inline CRUD ────────────────────────────────────────────────

interface NotesListProps {
  mapId: number;
  nodeId: number;
  notes: NoteRecord[];
  onChange: () => Promise<void> | void;
}

function NotesList({ mapId, nodeId, notes, onChange }: NotesListProps) {
  const [showCreate, setShowCreate] = useState(false);

  // Pinned-first sort (server already does this; defensive re-sort here so
  // optimistic updates don't drift from the rule).
  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return (
    <div className="node-detail-notes">
      <div className="node-detail-notes-header">
        <h3>Notes</h3>
        {!showCreate && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowCreate(true)}
          >
            + Note
          </button>
        )}
      </div>
      {showCreate && (
        <CreateNoteForm
          mapId={mapId}
          nodeId={nodeId}
          onCancel={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await onChange();
          }}
        />
      )}
      {sorted.length === 0 && !showCreate && (
        <p className="node-detail-notes-empty">No notes yet.</p>
      )}
      <ul className="node-detail-notes-list">
        {sorted.map((n) => (
          <li key={n.id}>
            <NoteCard mapId={mapId} note={n} onChange={onChange} />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CreateNoteFormProps {
  mapId: number;
  nodeId: number;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}

function CreateNoteForm({ mapId, nodeId, onCancel, onSaved }: CreateNoteFormProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const req: CreateNoteRequest = { text, pinned };
      if (title) req.title = title;
      if (color) req.color = color;
      await notesService.createNote(mapId, nodeId, req);
      await onSaved();
    } catch (e) {
      setError(extractApiError(e, 'Failed to create note.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="note-form">
      {error && <div className="alert alert-error">{error}</div>}
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="Note text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        rows={3}
      />
      <div className="note-form-row">
        <input
          type="text"
          placeholder="Color (e.g. #ff0000)"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="note-form-color"
        />
        <label className="note-form-pinned">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          Pinned
        </label>
      </div>
      <div className="note-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !text}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

interface NoteCardProps {
  mapId: number;
  note: NoteRecord;
  onChange: () => Promise<void> | void;
}

function NoteCard({ mapId, note, onChange }: NoteCardProps) {
  const [editing, setEditing] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await notesService.deleteNote(mapId, note.id);
      await onChange();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to delete note.'));
    }
  };

  if (editing) {
    return (
      <EditNoteForm
        mapId={mapId}
        note={note}
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          await onChange();
        }}
      />
    );
  }

  return (
    <article
      className={`note-card ${note.pinned ? 'note-card-pinned' : ''}`}
      style={note.color ? { borderLeftColor: note.color } : undefined}
    >
      <header className="note-card-header">
        <div className="note-card-titlebar">
          {note.pinned && <span className="note-pin" title="Pinned">📌</span>}
          {note.title && <strong>{note.title}</strong>}
        </div>
        {note.canEdit && (
          <div className="note-card-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>
        )}
      </header>
      <p className="note-card-text">{note.text}</p>
      <footer className="note-card-footer">
        <small>by {note.createdByUsername}</small>
      </footer>
    </article>
  );
}

interface EditNoteFormProps {
  mapId: number;
  note: NoteRecord;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}

function EditNoteForm({ mapId, note, onCancel, onSaved }: EditNoteFormProps) {
  const [title, setTitle] = useState(note.title);
  const [text, setText] = useState(note.text);
  const [color, setColor] = useState(note.color ?? '');
  const [pinned, setPinned] = useState(note.pinned);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const req: UpdateNoteRequest = { text, pinned };
      if (title !== note.title) req.title = title;
      if (color !== (note.color ?? '')) req.color = color;
      await notesService.updateNote(mapId, note.id, req);
      await onSaved();
    } catch (e) {
      setError(extractApiError(e, 'Failed to save note.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="note-form">
      {error && <div className="alert alert-error">{error}</div>}
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        rows={3}
      />
      <div className="note-form-row">
        <input
          type="text"
          placeholder="Color (e.g. #ff0000)"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="note-form-color"
        />
        <label className="note-form-pinned">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          Pinned
        </label>
      </div>
      <div className="note-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !text}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
