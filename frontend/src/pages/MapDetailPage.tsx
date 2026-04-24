import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { NotesPanel } from '@/components/Notes/NotesPanel';
import { useMap } from '@/hooks/useMap';
import { useAuthStore } from '@/store/authStore';
import { notesService, noteGroupsService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { Note, NoteGroup } from '@/types';

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const navigate = useNavigate();
  const { activeMap, loadMap, updateMap, deleteMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tenants = useAuthStore((s) => s.tenants);
  const storedTenantId = useAuthStore((s) => s.tenantId) ?? undefined;

  const currentTenant = tenants.find((t) => String(t.id) === tenantId);
  const isAdmin = currentTenant?.role === 'admin';

  // Shared notes/groups state (used by both MapView markers and NotesPanel list)
  const [notes, setNotes] = useState<Note[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Map click handler for "Place on map" feature
  const mapClickCallbackRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [isPlacingNote, setIsPlacingNote] = useState(false);

  // Edit-map modal state
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete-map state (no modal — uses window.confirm like deleteNote /
  // deleteAnnotation elsewhere in the app)
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapId) return;
    loadMap(Number(mapId))
      .catch(() => setError('Map not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [mapId, loadMap]);

  // Load notes and groups
  const loadNotesAndGroups = useCallback(async (groupFilter?: number) => {
    if (!mapId) return;
    try {
      setNotesError(null);
      const [g, n] = await Promise.all([
        noteGroupsService.listGroups(Number(mapId), storedTenantId),
        notesService.listNotes(Number(mapId), groupFilter, storedTenantId),
      ]);
      setGroups(g);
      setNotes(n);
    } catch (err) {
      setNotesError(extractApiError(err, 'Failed to load notes and groups.'));
    }
  }, [mapId, storedTenantId]);

  useEffect(() => {
    if (!loading && activeMap) {
      loadNotesAndGroups();
    }
  }, [loading, activeMap, loadNotesAndGroups]);

  const handleNoteClick = (_note: Note) => {
    // Future: pan map to note location
  };

  const handleRequestMapClick = useCallback((callback: (lat: number, lng: number) => void) => {
    mapClickCallbackRef.current = callback;
    setIsPlacingNote(true);
  }, []);

  const handleMapClickForNote = useCallback((lat: number, lng: number) => {
    if (mapClickCallbackRef.current) {
      mapClickCallbackRef.current(lat, lng);
      mapClickCallbackRef.current = null;
      setIsPlacingNote(false);
    }
  }, []);

  const handleCancelPlace = useCallback(() => {
    mapClickCallbackRef.current = null;
    setIsPlacingNote(false);
  }, []);

  const openEditModal = () => {
    if (!activeMap) return;
    setEditTitle(activeMap.title);
    setEditDescription(activeMap.description ?? '');
    setEditError(null);
    setShowEdit(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMap) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await updateMap(activeMap.id, {
        title: editTitle,
        description: editDescription,
      });
      setShowEdit(false);
    } catch (err) {
      setEditError(extractApiError(err, 'Failed to update map.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!activeMap) return;
    if (!window.confirm(`Delete "${activeMap.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMap(activeMap.id);
      navigate(`/tenants/${tenantId}/maps`);
    } catch (err) {
      setDeleteError(extractApiError(err, 'Failed to delete map.'));
      setDeleting(false);
    }
  };

  if (loading) return <div className="page-loading">Loading map…</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!activeMap) return null;

  const canEdit = activeMap.permission === 'edit' || activeMap.permission === 'owner';
  // Backend gates updateMap and deleteMap on owner_id = userId; non-owners
  // get a 403 even with permission='edit'. So buttons are owner-only.
  const isOwner = activeMap.permission === 'owner';

  return (
    <div className="map-page">
      <div className="map-page-header">
        <h2>{activeMap.title}</h2>
        {activeMap.description && <p>{activeMap.description}</p>}
        {(activeMap.permission === 'none') && (
          <p className="permission-notice">View only — sign in for more access</p>
        )}
        {isOwner && (
          <div className="map-page-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={openEditModal}
              disabled={deleting}
            >
              Edit map
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete map'}
            </button>
          </div>
        )}
      </div>
      {deleteError && <div className="alert alert-error">{deleteError}</div>}
      {notesError && <div className="alert alert-error">{notesError}</div>}

      {showEdit && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Edit Map</h2>
            <form onSubmit={handleEditSubmit} className="auth-form">
              {editError && <div className="alert alert-error">{editError}</div>}
              <div className="form-group">
                <label htmlFor="edit-map-title">Title</label>
                <input
                  id="edit-map-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-map-description">Description</label>
                <textarea
                  id="edit-map-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowEdit(false)}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="map-page-content">
        <MapView
          map={activeMap}
          notes={notes}
          noteGroups={groups}
          isPlacingNote={isPlacingNote}
          onMapClickForNote={handleMapClickForNote}
          onCancelPlace={handleCancelPlace}
          onNoteClick={handleNoteClick}
        />
        <NotesPanel
          mapId={activeMap.id}
          canEdit={canEdit}
          isAdmin={isAdmin}
          notes={notes}
          groups={groups}
          onNotesChanged={loadNotesAndGroups}
          onNoteClick={handleNoteClick}
          onRequestMapClick={handleRequestMapClick}
        />
      </div>
    </div>
  );
}
