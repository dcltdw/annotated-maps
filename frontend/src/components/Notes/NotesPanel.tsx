import { useState } from 'react';
import { notesService, noteGroupsService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type {
  Note, NoteGroup, CreateNoteRequest, CreateNoteGroupRequest, UpdateNoteRequest,
} from '@/types';
import { useAuthStore } from '@/store/authStore';
import { NoteCard, type NoteEdits } from './NoteCard';
import { NoteForm } from './NoteForm';
import { GroupForm } from './GroupForm';

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<NoteGroup | null>(null);

  // For "Place on map" — populated by parent's map click callback
  const [pendingLat, setPendingLat] = useState<number | null>(null);
  const [pendingLng, setPendingLng] = useState<number | null>(null);

  const filteredNotes = activeGroupId === null
    ? notes
    : notes.filter((n) => n.groupId === activeGroupId);

  const clearError = () => setActionError(null);

  // ─── Note CRUD ─────────────────────────────────────────────────────────────

  const handlePlaceOnMap = () => {
    if (!onRequestMapClick) return;
    onRequestMapClick((lat, lng) => {
      setPendingLat(lat);
      setPendingLng(lng);
    });
  };

  const handleCreateNote = async (data: CreateNoteRequest) => {
    if (data.lat === 0 && data.lng === 0 && onRequestMapClick) {
      setActionError('Please click "Place on map" to set the note location first.');
      return;
    }
    clearError();
    setSaving(true);
    try {
      await notesService.createNote(mapId, data, tenantId);
      setShowCreate(false);
      setPendingLat(null);
      setPendingLng(null);
      setTimeout(() => onNotesChanged(activeGroupId ?? undefined), 100);
    } catch (err) {
      setActionError(extractApiError(err, 'Failed to create note.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Delete this note?')) return;
    clearError();
    try {
      await notesService.deleteNote(mapId, noteId, tenantId);
      onNotesChanged(activeGroupId ?? undefined);
    } catch (err) {
      setActionError(extractApiError(err, 'Failed to delete note.'));
    }
  };

  const handleEditNote = async (note: Note, edits: NoteEdits) => {
    clearError();
    setSaving(true);
    try {
      const updateData: UpdateNoteRequest = {
        title: edits.title,
        text: edits.text,
        color: edits.color || undefined,
      };
      if (edits.groupId !== note.groupId) {
        updateData.groupId = edits.groupId;
      }
      await notesService.updateNote(mapId, note.id, updateData, tenantId);
      onNotesChanged(activeGroupId ?? undefined);
    } catch (err) {
      setActionError(extractApiError(err, 'Failed to update note.'));
      throw err; // so NoteCard keeps the edit form open
    } finally {
      setSaving(false);
    }
  };

  const handleMoveNote = (note: Note) => {
    if (!onRequestMapClick) return;
    clearError();
    onRequestMapClick(async (lat, lng) => {
      try {
        await notesService.updateNote(mapId, note.id, { lat, lng }, tenantId);
        onNotesChanged(activeGroupId ?? undefined);
      } catch (err) {
        setActionError(extractApiError(err, 'Failed to move note.'));
      }
    });
  };

  // ─── Group CRUD ────────────────────────────────────────────────────────────

  const handleOpenGroupForm = (group?: NoteGroup) => {
    clearError();
    setEditingGroup(group ?? null);
    setShowGroupForm(true);
  };

  const handleSaveGroup = async (data: CreateNoteGroupRequest) => {
    clearError();
    setSaving(true);
    try {
      if (editingGroup) {
        await noteGroupsService.updateGroup(mapId, editingGroup.id, data, tenantId);
      } else {
        await noteGroupsService.createGroup(mapId, data, tenantId);
      }
      setShowGroupForm(false);
      onNotesChanged(activeGroupId ?? undefined);
    } catch (err) {
      setActionError(extractApiError(err, 'Failed to save group.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (!window.confirm('Delete this group? Notes in this group will become ungrouped.')) return;
    clearError();
    try {
      await noteGroupsService.deleteGroup(mapId, groupId, tenantId);
      if (activeGroupId === groupId) setActiveGroupId(null);
      onNotesChanged();
    } catch (err) {
      setActionError(extractApiError(err, 'Failed to delete group.'));
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
              clearError();
              setShowCreate(true);
              setPendingLat(null);
              setPendingLng(null);
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

      {actionError && (
        <div className="alert alert-error" style={{ margin: '0.5rem 0' }}>
          {actionError}
          <button className="btn-icon" onClick={clearError} style={{ marginLeft: '0.5rem' }}>×</button>
        </div>
      )}

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

      {showCreate && (
        <NoteForm
          groups={groups}
          saving={saving}
          onCancel={() => setShowCreate(false)}
          onSubmit={handleCreateNote}
          onPlaceOnMap={onRequestMapClick ? handlePlaceOnMap : undefined}
          initialLat={pendingLat}
          initialLng={pendingLng}
        />
      )}

      {showGroupForm && (
        <GroupForm
          editingGroup={editingGroup}
          saving={saving}
          onCancel={() => setShowGroupForm(false)}
          onSubmit={handleSaveGroup}
        />
      )}

      <div className="notes-list">
        {filteredNotes.length === 0 ? (
          <p className="notes-empty">No notes yet.</p>
        ) : (
          filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              groups={groups}
              saving={saving}
              onClick={onNoteClick}
              onEdit={handleEditNote}
              onMove={handleMoveNote}
              onDelete={handleDeleteNote}
            />
          ))
        )}
      </div>
    </div>
  );
}
