import { useEffect, useState, useCallback } from 'react';
import { notesService, noteGroupsService } from '@/services/maps';
import type { Note, NoteGroup, CreateNoteRequest, CreateNoteGroupRequest } from '@/types';
import { useAuthStore } from '@/store/authStore';

interface NotesPanelProps {
  mapId: number;
  canEdit: boolean;
  isAdmin: boolean;
  onNoteClick?: (note: Note) => void;
}

export function NotesPanel({ mapId, canEdit, isAdmin, onNoteClick }: NotesPanelProps) {
  const tenantId = useAuthStore((s) => s.tenantId) ?? undefined;

  const [notes, setNotes] = useState<Note[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null); // null = "All"
  const [loading, setLoading] = useState(true);

  // Note creation
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newGroupId, setNewGroupId] = useState<number | undefined>(undefined);

  // Group management
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<NoteGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupColor, setGroupColor] = useState('');
  const [groupDesc, setGroupDesc] = useState('');

  // Edit note
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [g, n] = await Promise.all([
        noteGroupsService.listGroups(mapId, tenantId),
        notesService.listNotes(mapId, activeGroupId ?? undefined, tenantId),
      ]);
      setGroups(g);
      setNotes(n);
    } catch {
      // silently fail — panel shows empty
    } finally {
      setLoading(false);
    }
  }, [mapId, tenantId, activeGroupId]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // ─── Note CRUD ─────────────────────────────────────────────────────────────

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    const data: CreateNoteRequest = {
      lat: 0, lng: 0, // default — user can move later
      text: newText,
      title: newTitle || undefined,
      groupId: newGroupId,
    };
    try {
      const note = await notesService.createNote(mapId, data, tenantId);
      setNotes((prev) => [...prev, note]);
      setNewTitle('');
      setNewText('');
      setNewGroupId(undefined);
      setShowCreate(false);
    } catch {
      alert('Failed to create note.');
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await notesService.deleteNote(mapId, noteId, tenantId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      alert('Failed to delete note.');
    }
  };

  const handleStartEdit = (note: Note) => {
    setEditingNote(note);
    setEditTitle(note.title || '');
    setEditText(note.text);
  };

  const handleSaveEdit = async () => {
    if (!editingNote) return;
    try {
      await notesService.updateNote(mapId, editingNote.id, {
        title: editTitle, text: editText,
      }, tenantId);
      setNotes((prev) => prev.map((n) =>
        n.id === editingNote.id ? { ...n, title: editTitle, text: editText } : n
      ));
      setEditingNote(null);
    } catch {
      alert('Failed to update note.');
    }
  };

  // ─── Group CRUD ────────────────────────────────────────────────────────────

  const handleOpenGroupForm = (group?: NoteGroup) => {
    if (group) {
      setEditingGroup(group);
      setGroupName(group.name);
      setGroupColor(group.color || '');
      setGroupDesc(group.description || '');
    } else {
      setEditingGroup(null);
      setGroupName('');
      setGroupColor('');
      setGroupDesc('');
    }
    setShowGroupForm(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    const data: CreateNoteGroupRequest = {
      name: groupName,
      color: groupColor || undefined,
      description: groupDesc || undefined,
    };

    try {
      if (editingGroup) {
        await noteGroupsService.updateGroup(mapId, editingGroup.id, data, tenantId);
        setGroups((prev) => prev.map((g) =>
          g.id === editingGroup.id ? { ...g, ...data, name: groupName, color: groupColor, description: groupDesc } : g
        ));
      } else {
        const group = await noteGroupsService.createGroup(mapId, data, tenantId);
        setGroups((prev) => [...prev, group]);
      }
      setShowGroupForm(false);
    } catch {
      alert('Failed to save group.');
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (!window.confirm('Delete this group? Notes in this group will become ungrouped.')) return;
    try {
      await noteGroupsService.deleteGroup(mapId, groupId, tenantId);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      // Notes in this group now have null groupId — reload
      if (activeGroupId === groupId) setActiveGroupId(null);
      loadData();
    } catch {
      alert('Failed to delete group.');
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="notes-panel"><p>Loading notes...</p></div>;

  return (
    <div className="notes-panel">
      <div className="notes-header">
        <h3>Notes</h3>
        <div className="notes-header-actions">
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
              + Note
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-sm btn-ghost" onClick={() => handleOpenGroupForm()}>
              + Group
            </button>
          )}
        </div>
      </div>

      {/* Group tabs */}
      <div className="notes-tabs">
        <button
          className={`notes-tab ${activeGroupId === null ? 'active' : ''}`}
          onClick={() => setActiveGroupId(null)}
        >
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            className={`notes-tab ${activeGroupId === g.id ? 'active' : ''}`}
            onClick={() => setActiveGroupId(g.id)}
            style={g.color ? { borderBottomColor: g.color } : undefined}
          >
            {g.color && <span className="notes-tab-dot" style={{ backgroundColor: g.color }} />}
            {g.name}
            {isAdmin && (
              <span className="notes-tab-actions">
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleOpenGroupForm(g); }} title="Edit group">✎</button>
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id); }} title="Delete group">×</button>
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Note creation form */}
      {showCreate && (
        <form className="notes-form" onSubmit={handleCreateNote}>
          <input
            placeholder="Title (optional)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <textarea
            placeholder="Note text (required)"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            required
            rows={3}
          />
          {groups.length > 0 && (
            <select
              value={newGroupId ?? ''}
              onChange={(e) => setNewGroupId(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
          <div className="notes-form-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary">Save</button>
          </div>
        </form>
      )}

      {/* Group form (create/edit) */}
      {showGroupForm && (
        <form className="notes-form" onSubmit={handleSaveGroup}>
          <input
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required
          />
          <input
            placeholder="Color (e.g. #dc2626)"
            value={groupColor}
            onChange={(e) => setGroupColor(e.target.value)}
          />
          <input
            placeholder="Description (optional)"
            value={groupDesc}
            onChange={(e) => setGroupDesc(e.target.value)}
          />
          <div className="notes-form-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowGroupForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary">
              {editingGroup ? 'Update' : 'Create'} Group
            </button>
          </div>
        </form>
      )}

      {/* Note list */}
      <div className="notes-list">
        {notes.length === 0 ? (
          <p className="notes-empty">No notes yet.</p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className={`note-card ${note.pinned ? 'pinned' : ''}`}
              onClick={() => onNoteClick?.(note)}
            >
              {editingNote?.id === note.id ? (
                <div className="note-edit-form" onClick={(e) => e.stopPropagation()}>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Title"
                  />
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                  />
                  <div className="notes-form-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingNote(null)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  {note.pinned && <span className="note-pin-badge">📌</span>}
                  {note.title && <h4 className="note-title">{note.title}</h4>}
                  <p className="note-text">{note.text}</p>
                  <div className="note-meta">
                    <small>By {note.createdByUsername}</small>
                    {note.canEdit && (
                      <span className="note-actions">
                        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleStartEdit(note); }} title="Edit">✎</button>
                        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }} title="Delete">×</button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
