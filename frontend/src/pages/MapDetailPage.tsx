import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { NotesPanel } from '@/components/Notes/NotesPanel';
import { useMap } from '@/hooks/useMap';
import { useAuthStore } from '@/store/authStore';
import { notesService, noteGroupsService } from '@/services/maps';
import type { Note, NoteGroup } from '@/types';

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const { activeMap, loadMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tenants = useAuthStore((s) => s.tenants);
  const storedTenantId = useAuthStore((s) => s.tenantId) ?? undefined;

  const currentTenant = tenants.find((t) => String(t.id) === tenantId);
  const isAdmin = currentTenant?.role === 'admin';

  // Shared notes/groups state (used by both MapView markers and NotesPanel list)
  const [notes, setNotes] = useState<Note[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);

  // Map click handler for "Place on map" feature
  const mapClickCallbackRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [isPlacingNote, setIsPlacingNote] = useState(false);

  useEffect(() => {
    if (!mapId) return;
    loadMap(Number(mapId))
      .catch(() => setError('Map not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [mapId, loadMap]);

  // Load notes and groups
  const loadNotesAndGroups = useCallback(async (groupFilter?: number) => {
    console.log('loadNotesAndGroups called, mapId:', mapId, 'groupFilter:', groupFilter);
    if (!mapId) return;
    try {
      const [g, n] = await Promise.all([
        noteGroupsService.listGroups(Number(mapId), storedTenantId),
        notesService.listNotes(Number(mapId), groupFilter, storedTenantId),
      ]);
      console.log('Notes loaded:', n.length, 'Groups loaded:', g.length);
      setGroups(g);
      setNotes(n);
    } catch (err) {
      console.error('Failed to load notes/groups:', err);
    }
  }, [mapId, storedTenantId]);

  useEffect(() => {
    if (!loading && activeMap) {
      loadNotesAndGroups();
    }
  }, [loading, activeMap, loadNotesAndGroups]);

  const handleNoteClick = (note: Note) => {
    console.log('Note clicked:', note.id, note.lat, note.lng);
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

  if (loading) return <div className="page-loading">Loading map…</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!activeMap) return null;

  const canEdit = activeMap.permission === 'edit' || activeMap.permission === 'owner';

  return (
    <div className="map-page">
      <div className="map-page-header">
        <h2>{activeMap.title}</h2>
        {activeMap.description && <p>{activeMap.description}</p>}
        {(activeMap.permission === 'none') && (
          <p className="permission-notice">View only — sign in for more access</p>
        )}
      </div>
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
