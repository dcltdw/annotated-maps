import { useState } from 'react';
import { notesService, noteGroupsService } from '@/services/maps';
import type { Note, NoteGroup, CreateNoteRequest, CreateNoteGroupRequest } from '@/types';
import { useAuthStore } from '@/store/authStore';

interface NotesPanelProps {
  mapId: number;
  canEdit: boolean;
  isAdmin: boolean;
  notes: Note[];
  groups: NoteGroup[];
  onNotesChanged: (groupFilter?: number) => void;
  onNoteClick?: (note: Note) => void;
  onRequestMapClick?: (callback: (lat: number, lng: number) => void) => void;
}

export function NotesPanel({
  mapId, canEdit, isAdmin, notes, groups,
  onNotesChanged, onNoteClick, onRequestMapClick
}: NotesPanelProps) {
  const tenantId = useAuthStore((s) => s.tenantId) ?? undefined;

  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);

  // Note creation
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newGroupId, setNewGroupId] = useState<number | undefined>(undefined);
  const [newColor, setNewColor] = useState('');
  const [newLat, setNewLat] = useState<number | null>(null);
  const [newLng, setNewLng] = useState<number | null>(null);

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
  const [editColor, setEditColor] = useState('');
  const [editGroupId, setEditGroupId] = useState<number | null>(null);

  // Filter notes by active group tab
  const filteredNotes = activeGroupId === null
    ? notes
    : notes.filter((n) => n.groupId === activeGroupId);

  // ─── Note CRUD ─────────────────────────────────────────────────────────────

  const handlePlaceOnMap = () => {
    if (!onRequestMapClick) return;
    onRequestMapClick((lat, lng) => {
      setNewLat(lat);
      setNewLng(lng);
    });
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    if (newLat === null || newLng === null) {
      if (onRequestMapClick) {
        alert('Please click "Place on map" to set the note location first.');
        return;
      }
    }

    const data: CreateNoteRequest = {
      lat: newLat ?? 0,
      lng: newLng ?? 0,
      text: newText,
      title: newTitle || undefined,
      color: newColor || undefined,
      groupId: newGroupId,
    };
    try {
      await notesService.createNote(mapId, data, tenantId);
      setNewTitle('');
      setNewText('');
      setNewColor('');
      setNewGroupId(undefined);
      setNewLat(null);
      setNewLng(null);
      setShowCreate(false);
      // Reload notes from server — use setTimeout to ensure state updates have flushed
      setTimeout(() => onNotesChanged(activeGroupId ?? undefined), 100);
    } catch (err) {
      console.error('Failed to create note:', err);
      alert('Failed to create note.');
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await notesService.deleteNote(mapId, noteId, tenantId);
      onNotesChanged(activeGroupId ?? undefined);
    } catch {
      alert('Failed to delete note.');
    }
  };

  const handleStartEdit = (note: Note) => {
    setEditingNote(note);
    setEditTitle(note.title || '');
    setEditText(note.text);
    setEditColor(note.color || '');
    setEditGroupId(note.groupId);
  };

  const handleSaveEdit = async () => {
    if (!editingNote) return;
    try {
      const updateData: Record<string, unknown> = {
        title: editTitle,
        text: editText,
        color: editColor || undefined,
      };
      // Send groupId: null to ungroup, number to assign, omit for no change
      if (editGroupId !== editingNote.groupId) {
        updateData.groupId = editGroupId;
      }
      await notesService.updateNote(mapId, editingNote.id, updateData as any, tenantId);
      setEditingNote(null);
      onNotesChanged(activeGroupId ?? undefined);
    } catch {
      alert('Failed to update note.');
    }
  };

  const handleMoveNote = (note: Note) => {
    if (!onRequestMapClick) return;
    onRequestMapClick(async (lat, lng) => {
      try {
        await notesService.updateNote(mapId, note.id, { lat, lng } as any, tenantId);
        onNotesChanged(activeGroupId ?? undefined);
      } catch {
        alert('Failed to move note.');
      }
    });
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
      } else {
        await noteGroupsService.createGroup(mapId, data, tenantId);
      }
      setShowGroupForm(false);
      onNotesChanged(activeGroupId ?? undefined);
    } catch {
      alert('Failed to save group.');
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (!window.confirm('Delete this group? Notes in this group will become ungrouped.')) return;
    try {
      await noteGroupsService.deleteGroup(mapId, groupId, tenantId);
      if (activeGroupId === groupId) setActiveGroupId(null);
      onNotesChanged();
    } catch {
      alert('Failed to delete group.');
    }
  };

  const handleTabClick = (groupId: number | null) => {
    setActiveGroupId(groupId);
    onNotesChanged(groupId ?? undefined);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="notes-panel">
      <div className="notes-header">
        <h3>Notes</h3>
        <div className="notes-header-actions">
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => {
              setShowCreate(true);
              setNewLat(null);
              setNewLng(null);
            }}>
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
          onClick={() => handleTabClick(null)}
        >
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            className={`notes-tab ${activeGroupId === g.id ? 'active' : ''}`}
            onClick={() => handleTabClick(g.id)}
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
          <input
            placeholder="Pin color (e.g. #ff0000, optional)"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
          />
          <div className="notes-location">
            {newLat !== null && newLng !== null ? (
              <span className="notes-location-set">
                📍 {newLat.toFixed(4)}, {newLng.toFixed(4)}
                <button type="button" className="btn-icon" onClick={() => { setNewLat(null); setNewLng(null); }}>×</button>
              </span>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost" onClick={handlePlaceOnMap}>
                📍 Place on map
              </button>
            )}
          </div>
          <div className="notes-form-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-sm btn-primary">Save</button>
          </div>
        </form>
      )}

      {/* Group form */}
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
        {filteredNotes.length === 0 ? (
          <p className="notes-empty">No notes yet.</p>
        ) : (
          filteredNotes.map((note) => (
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
                  <input
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    placeholder="Pin color (e.g. #ff0000)"
                  />
                  {groups.length > 0 && (
                    <select
                      value={editGroupId ?? ''}
                      onChange={(e) => setEditGroupId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">No group</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  )}
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
                    <small>By {note.createdByUsername || 'unknown'}</small>
                    {note.canEdit && (
                      <span className="note-actions">
                        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleStartEdit(note); }} title="Edit">✎</button>
                        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleMoveNote(note); }} title="Move">⤢</button>
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
