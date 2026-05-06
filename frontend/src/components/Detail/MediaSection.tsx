import { useCallback, useEffect, useState } from 'react';
import { nodeMediaService, noteMediaService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type {
  NodeMediaRecord,
  NoteMediaRecord,
  CreateMediaRequest,
  NodeMediaType,
} from '@/types';

// Phase 2g.l (#166): per-entity Media section. Lists images and links
// attached to a node or note; supports add (image / link), edit caption,
// and delete.
//
// Backed by:
//   GET    /…/nodes/{nid}/media   /  /…/notes/{nid}/media
//   POST   …/media                 (mediaType, url, caption?)
//   PUT    …/media/{mediaId}       (caption — URL changes go through delete-and-recreate)
//   DELETE …/media/{mediaId}
//
// kind = 'node' | 'note' switches which service the component talks to.
// Same pattern as PlotsSection (#139) and VisibilityEditor (#105).

type MediaRecord = NodeMediaRecord | NoteMediaRecord;

interface MediaSectionProps {
  mapId: number;
  kind: 'node' | 'note';
  entityId: number;
}

export function MediaSection({ mapId, kind, entityId }: MediaSectionProps) {
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Form state — exactly one of these can be open at a time.
  // 'create-image' / 'create-link' show the URL+caption form for that type;
  // 'edit-{id}' shows the caption-only edit form for that media id.
  const [formMode, setFormMode] = useState<
    | { kind: 'closed' }
    | { kind: 'create'; type: NodeMediaType }
    | { kind: 'edit'; mediaId: number; initialCaption: string }
  >({ kind: 'closed' });

  const service = kind === 'node' ? nodeMediaService : noteMediaService;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await service.listMedia(mapId, entityId);
      setMedia(fresh);
    } catch (e) {
      setError(extractApiError(e, 'Failed to load media.'));
      setMedia([]);
    } finally {
      setLoading(false);
    }
  }, [service, mapId, entityId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = async (m: MediaRecord) => {
    if (!window.confirm(`Delete this ${m.mediaType}?`)) return;
    try {
      await service.deleteMedia(mapId, entityId, m.id);
      await reload();
    } catch (e) {
      window.alert(extractApiError(e, 'Failed to delete media.'));
    }
  };

  if (loading) {
    return (
      <div className="media-section">
        <h3>Media</h3>
        <p className="media-section-empty">Loading…</p>
      </div>
    );
  }

  return (
    <div className="media-section">
      <div className="media-section-header">
        <h3>Media</h3>
        {formMode.kind === 'closed' && (
          <div className="media-section-add-buttons">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFormMode({ kind: 'create', type: 'image' })}
            >
              + Image
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFormMode({ kind: 'create', type: 'link' })}
            >
              + Link
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {formMode.kind === 'create' && (
        <CreateMediaForm
          type={formMode.type}
          onCancel={() => setFormMode({ kind: 'closed' })}
          onSubmit={async (data) => {
            await service.addMedia(mapId, entityId, data);
            setFormMode({ kind: 'closed' });
            await reload();
          }}
        />
      )}

      {/* Display existing media. Images are rendered as a thumbnail
          row; links as a list. Each row carries Edit + Delete. */}
      {media.filter((m) => m.mediaType === 'image').length > 0 && (
        <div className="media-section-images">
          {media
            .filter((m) => m.mediaType === 'image')
            .map((m) => (
              <MediaImageItem
                key={m.id}
                media={m}
                isEditing={formMode.kind === 'edit' && formMode.mediaId === m.id}
                onStartEdit={() =>
                  setFormMode({ kind: 'edit', mediaId: m.id, initialCaption: m.caption })
                }
                onCancelEdit={() => setFormMode({ kind: 'closed' })}
                onSaveEdit={async (caption) => {
                  await service.updateMedia(mapId, entityId, m.id, { caption });
                  setFormMode({ kind: 'closed' });
                  await reload();
                }}
                onDelete={() => handleDelete(m)}
              />
            ))}
        </div>
      )}

      {media.filter((m) => m.mediaType === 'link').length > 0 && (
        <ul className="media-section-links">
          {media
            .filter((m) => m.mediaType === 'link')
            .map((m) => (
              <MediaLinkItem
                key={m.id}
                media={m}
                isEditing={formMode.kind === 'edit' && formMode.mediaId === m.id}
                onStartEdit={() =>
                  setFormMode({ kind: 'edit', mediaId: m.id, initialCaption: m.caption })
                }
                onCancelEdit={() => setFormMode({ kind: 'closed' })}
                onSaveEdit={async (caption) => {
                  await service.updateMedia(mapId, entityId, m.id, { caption });
                  setFormMode({ kind: 'closed' });
                  await reload();
                }}
                onDelete={() => handleDelete(m)}
              />
            ))}
        </ul>
      )}

      {media.length === 0 && formMode.kind === 'closed' && (
        <p className="media-section-empty">No media attached.</p>
      )}
    </div>
  );
}

// ─── Create form (image or link) ─────────────────────────────────────────────

interface CreateMediaFormProps {
  type: NodeMediaType;
  onCancel: () => void;
  onSubmit: (data: CreateMediaRequest) => Promise<void>;
}

function CreateMediaForm({ type, onCancel, onSubmit }: CreateMediaFormProps) {
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const req: CreateMediaRequest = { mediaType: type, url: url.trim() };
      if (caption.trim()) req.caption = caption.trim();
      await onSubmit(req);
    } catch (err) {
      setError(extractApiError(err, 'Failed to add media.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="media-form">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-group">
        <label htmlFor="media-url">{type === 'image' ? 'Image URL' : 'Link URL'}</label>
        <input
          id="media-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder={type === 'image' ? 'https://example.com/photo.jpg' : 'https://example.com'}
          disabled={saving}
          autoFocus
        />
      </div>
      <div className="form-group">
        <label htmlFor="media-caption">Caption (optional)</label>
        <input
          id="media-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={type === 'image' ? 'Describe what\'s in the image' : 'Display text for the link'}
          disabled={saving}
        />
      </div>
      <div className="media-form-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={saving || !url.trim()}
        >
          {saving ? 'Saving…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

// ─── Per-row image (with edit + delete) ──────────────────────────────────────

interface MediaImageItemProps {
  media: MediaRecord;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (caption: string) => Promise<void>;
  onDelete: () => void;
}

function MediaImageItem({
  media,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: MediaImageItemProps) {
  return (
    <div className="media-image-item">
      <img src={media.url} alt={media.caption || 'attached image'} className="media-thumb" />
      {isEditing ? (
        <EditCaptionForm
          initialCaption={media.caption}
          onCancel={onCancelEdit}
          onSubmit={onSaveEdit}
        />
      ) : (
        <div className="media-image-caption">
          {media.caption && <span>{media.caption}</span>}
          <div className="media-row-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStartEdit}>
              Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Per-row link (with edit + delete) ───────────────────────────────────────

interface MediaLinkItemProps {
  media: MediaRecord;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (caption: string) => Promise<void>;
  onDelete: () => void;
}

function MediaLinkItem({
  media,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: MediaLinkItemProps) {
  return (
    <li className="media-link-item">
      {isEditing ? (
        <EditCaptionForm
          initialCaption={media.caption}
          onCancel={onCancelEdit}
          onSubmit={onSaveEdit}
        />
      ) : (
        <>
          <a href={media.url} target="_blank" rel="noopener noreferrer">
            {media.caption || media.url}
          </a>
          <div className="media-row-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStartEdit}>
              Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete}>
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

// ─── Caption-only edit form ──────────────────────────────────────────────────
// Used by both image and link edit. URL changes go through delete-and-recreate
// per backend semantics (PUT /media/{id} only accepts caption).

interface EditCaptionFormProps {
  initialCaption: string;
  onCancel: () => void;
  onSubmit: (caption: string) => Promise<void>;
}

function EditCaptionForm({ initialCaption, onCancel, onSubmit }: EditCaptionFormProps) {
  const [caption, setCaption] = useState(initialCaption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(caption);
    } catch (err) {
      setError(extractApiError(err, 'Failed to update caption.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="media-edit-form">
      {error && <div className="alert alert-error">{error}</div>}
      <input
        type="text"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Caption"
        disabled={saving}
        autoFocus
      />
      <div className="media-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
