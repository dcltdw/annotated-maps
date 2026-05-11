import { useState } from 'react';
import { edgesService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { EdgeRecord, NodeRecord } from '@/types';

// Modal for creating a new edge or editing an existing one (#199).
// In create mode the source/dest endpoints are immutable inputs picked
// in the toolbar's two-step flow; in edit mode the endpoints are read-
// only too (per #148 design — re-targeting an edge means delete +
// recreate, keeping audit semantics simple).
//
// Form fields (both modes): label, description, color, directed.
// Edit mode adds a Delete affordance.

interface EdgeFormModalProps {
  mode: 'create' | 'edit';
  mapId: number;
  sourceNode: NodeRecord;
  destNode: NodeRecord;
  /** Required in edit mode; null/undefined in create mode. */
  initial?: EdgeRecord | null;
  onSaved: (edge: EdgeRecord) => void;
  /** Only invoked from edit mode. */
  onDeleted?: () => void;
  onClose: () => void;
}

export function EdgeFormModal({
  mode,
  mapId,
  sourceNode,
  destNode,
  initial,
  onSaved,
  onDeleted,
  onClose,
}: EdgeFormModalProps) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? '#3388ff');
  const [directed, setDirected] = useState(initial?.directed ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    try {
      let saved: EdgeRecord;
      if (mode === 'create') {
        saved = await edgesService.createEdge(mapId, {
          sourceNodeId: sourceNode.id,
          destNodeId: destNode.id,
          directed,
          color: color || undefined,
          label: label || undefined,
          description: description || undefined,
        });
      } else if (initial) {
        saved = await edgesService.updateEdge(mapId, initial.id, {
          directed,
          color,
          label,
          description,
        });
      } else {
        throw new Error('Edit mode requires an initial edge');
      }
      onSaved(saved);
    } catch (e) {
      setError(extractApiError(e, 'Failed to save edge.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!initial || !onDeleted) return;
    if (!window.confirm('Delete this edge? This cannot be undone.')) return;
    setError(null);
    setBusy(true);
    try {
      await edgesService.deleteEdge(mapId, initial.id);
      onDeleted();
    } catch (e) {
      setError(extractApiError(e, 'Failed to delete edge.'));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>{mode === 'create' ? 'New edge' : 'Edit edge'}</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="form-group">
          <label>From</label>
          <div>{sourceNode.name}</div>
        </div>
        <div className="form-group">
          <label>To</label>
          <div>{destNode.name}</div>
        </div>

        <div className="form-group">
          <label htmlFor="edge-label">Label</label>
          <input
            id="edge-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
            maxLength={255}
          />
        </div>

        <div className="form-group">
          <label htmlFor="edge-description">Description</label>
          <textarea
            id="edge-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="form-group">
          <label htmlFor="edge-color">Color</label>
          <input
            id="edge-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>

        <div className="form-group-checkbox">
          <label>
            <input
              type="checkbox"
              checked={directed}
              onChange={(e) => setDirected(e.target.checked)}
            />
            Directed (arrow from source to destination)
          </label>
        </div>

        <div className="modal-actions">
          {mode === 'edit' && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={busy}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
