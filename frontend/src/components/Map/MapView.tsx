import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap as useLeafletMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import L from 'leaflet';
import 'leaflet-draw';
import { AnnotationLayer } from './AnnotationLayer';
import { NoteMarkers } from './NoteMarkers';
import { useMap } from '@/hooks/useMap';
import type { MapRecord, AnnotationType, GeoJsonGeometry, Note, NoteGroup } from '@/types';

// Fix default marker icon broken by webpack/vite bundling
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface DrawControlsProps {
  mapId: number;
  canEdit: boolean;
}

function DrawControls({ mapId, canEdit }: DrawControlsProps) {
  const leafletMap = useLeafletMap();
  const { createAnnotation, setIsDrawing } = useMap();
  const drawnItemsRef = useRef<L.FeatureGroup>(new L.FeatureGroup());

  useEffect(() => {
    if (!canEdit) return;

    const drawnItems = drawnItemsRef.current;
    leafletMap.addLayer(drawnItems);

    const drawControl = new (L.Control as unknown as { Draw: new (options: object) => L.Control }).Draw({
      position: 'topright',
      draw: {
        polyline: { shapeOptions: { color: '#2563eb', weight: 3 } },
        polygon: { allowIntersection: false, shapeOptions: { color: '#2563eb', fillOpacity: 0.2 } },
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: { icon: new L.Icon.Default() },
      },
      edit: { featureGroup: drawnItems },
    });
    leafletMap.addControl(drawControl);

    const onDrawStart = () => setIsDrawing(true);
    const onDrawStop = () => setIsDrawing(false);

    // ─── CREATE ──────────────────────────────────────────────────────────

    const onCreated = async (e: L.LeafletEvent) => {
      const event = e as L.DrawEvents.Created;
      const layer = event.layer;
      drawnItems.addLayer(layer);

      let type: AnnotationType;
      let geoJson: GeoJsonGeometry;

      if (layer instanceof L.Marker) {
        type = 'marker';
        const latlng = layer.getLatLng();
        geoJson = { type: 'Point', coordinates: [latlng.lng, latlng.lat] };
      } else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        type = 'polyline';
        const latlngs = layer.getLatLngs() as L.LatLng[];
        geoJson = { type: 'LineString', coordinates: latlngs.map((ll) => [ll.lng, ll.lat]) };
      } else if (layer instanceof L.Polygon) {
        type = 'polygon';
        const latlngs = (layer.getLatLngs() as L.LatLng[][])[0];
        const coords = latlngs.map((ll) => [ll.lng, ll.lat]);
        coords.push(coords[0]); // close ring
        geoJson = { type: 'Polygon', coordinates: [coords] };
      } else {
        return;
      }

      const title = window.prompt('Annotation title (required):');
      if (!title) {
        drawnItems.removeLayer(layer);
        return;
      }
      const description = window.prompt('Description (optional):') ?? '';

      try {
        await createAnnotation({ mapId, type, title, description, geoJson });
        drawnItems.removeLayer(layer); // AnnotationLayer will re-render from store
      } catch {
        drawnItems.removeLayer(layer);
        alert('Failed to save annotation.');
      }
    };

    leafletMap.on(L.Draw.Event.DRAWSTART, onDrawStart);
    leafletMap.on(L.Draw.Event.DRAWSTOP, onDrawStop);
    leafletMap.on(L.Draw.Event.CREATED, onCreated);

    return () => {
      leafletMap.removeLayer(drawnItems);
      leafletMap.removeControl(drawControl);
      leafletMap.off(L.Draw.Event.DRAWSTART, onDrawStart);
      leafletMap.off(L.Draw.Event.DRAWSTOP, onDrawStop);
      leafletMap.off(L.Draw.Event.CREATED, onCreated);
    };
  }, [leafletMap, mapId, canEdit, createAnnotation, setIsDrawing]);

  return null;
}

// ─── Note placement mode ─────────────────────────────────────────────────────

interface NotePlacementProps {
  isActive: boolean;
  onPlace: (lat: number, lng: number) => void;
  onCancel: () => void;
}

function NotePlacement({ isActive, onPlace, onCancel }: NotePlacementProps) {
  const leafletMap = useLeafletMap();

  useEffect(() => {
    if (!isActive) return;

    const mapContainer = leafletMap.getContainer();
    mapContainer.style.cursor = 'crosshair';
    let placementMarker: L.CircleMarker | null = null;

    const hint = document.createElement('div');
    hint.className = 'move-hint';
    hint.textContent = 'Click to place note (Esc to cancel)';
    mapContainer.appendChild(hint);

    const handleClick = (e: L.LeafletMouseEvent) => {
      // Leave a temporary marker showing where the note will be placed
      placementMarker = L.circleMarker([e.latlng.lat, e.latlng.lng], {
        radius: 10,
        fillColor: '#00FFFF',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      }).addTo(leafletMap);
      placementMarker.bindPopup('Note will be placed here').openPopup();

      // Remove marker after 5 seconds (note form is still open)
      setTimeout(() => {
        if (placementMarker) {
          leafletMap.removeLayer(placementMarker);
          placementMarker = null;
        }
      }, 5000);

      cleanup();
      onPlace(e.latlng.lat, e.latlng.lng);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        onCancel();
      }
    };

    const cleanup = () => {
      mapContainer.style.cursor = '';
      hint.remove();
      leafletMap.off('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };

    leafletMap.once('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    return cleanup;
  }, [isActive, leafletMap, onPlace, onCancel]);

  return null;
}

// ─── MapView ─────────────────────────────────────────────────────────────────

interface MapViewProps {
  map: MapRecord;
  notes?: Note[];
  noteGroups?: NoteGroup[];
  isPlacingNote?: boolean;
  onMapClickForNote?: (lat: number, lng: number) => void;
  onCancelPlace?: () => void;
  onNoteClick?: (note: Note) => void;
}

export function MapView({ map, notes, noteGroups, isPlacingNote, onMapClickForNote, onCancelPlace, onNoteClick }: MapViewProps) {
  const canEdit = map.permission === 'edit' || map.permission === 'owner';

  return (
    <div className="map-wrapper">
      <MapContainer
        center={[map.centerLat, map.centerLng]}
        zoom={map.zoom}
        className="leaflet-map"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <AnnotationLayer mapId={map.id} canEdit={canEdit} />
        <DrawControls mapId={map.id} canEdit={canEdit} />
        {notes && noteGroups && (
          <NoteMarkers notes={notes} groups={noteGroups} onNoteClick={onNoteClick} />
        )}
        {isPlacingNote && onMapClickForNote && onCancelPlace && (
          <NotePlacement
            isActive={isPlacingNote}
            onPlace={onMapClickForNote}
            onCancel={onCancelPlace}
          />
        )}
      </MapContainer>
    </div>
  );
}
