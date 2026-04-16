import { useState } from 'react';
import type { NoteGroup, CreateNoteGroupRequest } from '@/types';

interface GroupFormProps {
  editingGroup: NoteGroup | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (data: CreateNoteGroupRequest) => Promise<void>;
}

export function GroupForm({ editingGroup, saving, onCancel, onSubmit }: GroupFormProps) {
  const [name, setName] = useState(editingGroup?.name ?? '');
  const [color, setColor] = useState(editingGroup?.color ?? '');
  const [description, setDescription] = useState(editingGroup?.description ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onSubmit({
      name,
      color: color || undefined,
      description: description || undefined,
    });
  };

  return (
    <form className="notes-form" onSubmit={handleSubmit}>
      <input
        placeholder="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        placeholder="Color (e.g. #dc2626)"
        value={color}
        onChange={(e) => setColor(e.target.value)}
      />
      <input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="notes-form-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
          {saving ? 'Saving…' : (editingGroup ? 'Update' : 'Create') + ' Group'}
        </button>
      </div>
    </form>
  );
}
