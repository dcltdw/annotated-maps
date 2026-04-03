import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { MapView } from '@/components/Map/MapView';
import { NotesPanel } from '@/components/Notes/NotesPanel';
import { useMap } from '@/hooks/useMap';
import { useAuthStore } from '@/store/authStore';
import type { Note } from '@/types';

export function MapDetailPage() {
  const { mapId, tenantId } = useParams<{ mapId: string; tenantId: string }>();
  const { activeMap, loadMap } = useMap();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tenants = useAuthStore((s) => s.tenants);

  const currentTenant = tenants.find((t) => String(t.id) === tenantId);
  const isAdmin = currentTenant?.role === 'admin';

  // Map click handler for "Place on map" feature
  const mapClickCallbackRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [isPlacingNote, setIsPlacingNote] = useState(false);

  useEffect(() => {
    if (!mapId) return;
    loadMap(Number(mapId))
      .catch(() => setError('Map not found or you do not have permission to view it.'))
      .finally(() => setLoading(false));
  }, [mapId, loadMap]);

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
          isPlacingNote={isPlacingNote}
          onMapClickForNote={handleMapClickForNote}
          onCancelPlace={handleCancelPlace}
        />
        <NotesPanel
          mapId={activeMap.id}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onNoteClick={handleNoteClick}
          onRequestMapClick={handleRequestMapClick}
        />
      </div>
    </div>
  );
}
