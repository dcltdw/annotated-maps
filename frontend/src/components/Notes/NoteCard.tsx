import { useState } from 'react';
import type { Note, NoteGroup } from '@/types';

interface NoteCardProps {
  note: Note;
  groups: NoteGroup[];
  saving: boolean;
  onClick?: (note: Note) => void;
  onEdit: (note: Note, edits: NoteEdits) => Promise<void>;
  onMove: (note: Note) => void;
  onDelete: (noteId: number) => void;
}

export interface NoteEdits {
  title: string;
  text: string;
  color: string;
  groupId: number | null;
}

export function NoteCard({ note, groups, saving, onClick, onEdit, onMove, onDelete }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editGroupId, setEditGroupId] = useState<number | null>(null);

  const startEdit = () => {
    setEditTitle(note.title || '');
    setEditText(note.text);
    setEditColor(note.color || '');
    setEditGroupId(note.groupId);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    await onEdit(note, {
      title: editTitle,
      text: editText,
      color: editColor,
      groupId: editGroupId,
    });
    setEditing(false);
  };

  return (
    <div
      className={`note-card ${note.pinned ? 'pinned' : ''}`}
      onClick={() => !editing && onClick?.(note)}
    >
      {editing ? (
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
            <button className="btn btn-sm btn-ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
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
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); startEdit(); }} title="Edit">✎</button>
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onMove(note); }} title="Move">⤢</button>
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onDelete(note.id); }} title="Delete">×</button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
