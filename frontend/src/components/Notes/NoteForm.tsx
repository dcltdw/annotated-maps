import { useState } from 'react';
import type { NoteGroup, CreateNoteRequest } from '@/types';

interface NoteFormProps {
  groups: NoteGroup[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (data: CreateNoteRequest) => Promise<void>;
  onPlaceOnMap?: () => void;
  /** When set externally (parent received map click), pre-fills lat/lng */
  initialLat?: number | null;
  initialLng?: number | null;
}

export function NoteForm({
  groups, saving, onCancel, onSubmit, onPlaceOnMap, initialLat, initialLng
}: NoteFormProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState<number | undefined>(undefined);
  const [color, setColor] = useState('');
  const [lat, setLat] = useState<number | null>(initialLat ?? null);
  const [lng, setLng] = useState<number | null>(initialLng ?? null);

  // Sync external lat/lng updates from parent (when user clicks map)
  if (initialLat !== undefined && initialLat !== lat) setLat(initialLat);
  if (initialLng !== undefined && initialLng !== lng) setLng(initialLng);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await onSubmit({
      lat: lat ?? 0,
      lng: lng ?? 0,
      text,
      title: title || undefined,
      color: color || undefined,
      groupId,
    });
  };

  return (
    <form className="notes-form" onSubmit={handleSubmit}>
      <input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="Note text (required)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        rows={3}
      />
      {groups.length > 0 && (
        <select
          value={groupId ?? ''}
          onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      )}
      <input
        placeholder="Pin color (e.g. #ff0000, optional)"
        value={color}
        onChange={(e) => setColor(e.target.value)}
      />
      <div className="notes-location">
        {lat !== null && lng !== null ? (
          <span className="notes-location-set">
            📍 {lat.toFixed(4)}, {lng.toFixed(4)}
            <button type="button" className="btn-icon" onClick={() => { setLat(null); setLng(null); }}>×</button>
          </span>
        ) : onPlaceOnMap ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onPlaceOnMap}>
            📍 Place on map
          </button>
        ) : null}
      </div>
      <div className="notes-form-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
