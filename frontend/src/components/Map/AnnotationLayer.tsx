import { useEffect, useRef } from 'react';
import { useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore } from '@/store/mapStore';
import { useAuthStore } from '@/store/authStore';
import { annotationsService } from '@/services/maps';
import type { GeoJsonGeometry } from '@/types';

interface AnnotationLayerProps {
  mapId: number;
  canEdit: boolean;
}

function showMapError(map: L.Map, message: string) {
  const container = map.getContainer();
  const banner = document.createElement('div');
  banner.className = 'map-error-banner';
  banner.textContent = message;
  container.appendChild(banner);
  setTimeout(() => banner.remove(), 5000);
}

// Defense-in-depth scheme check for media URLs.
// The backend also validates this on submit; this guards against ever
// rendering a stored javascript: or data: URL that slipped past server
// validation.
function isSafeMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AnnotationLayer({ mapId, canEdit }: AnnotationLayerProps) {
  const leafletMap = useLeafletMap();
  const annotations = useMapStore((s) => s.annotations);
  const updateAnnotationInStore = useMapStore((s) => s.updateAnnotation);
  const removeAnnotationFromStore = useMapStore((s) => s.removeAnnotation);
  const setSelectedAnnotationId = useMapStore((s) => s.setSelectedAnnotationId);
  const tenantId = useAuthStore((s) => s.tenantId);

  const layerMapRef = useRef<Map<number, L.Layer>>(new Map());
  const featureGroupRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  // Track move mode so we can clean up the click handler
  const moveStateRef = useRef<{ annotationId: number; cleanup: () => void } | null>(null);

  useEffect(() => {
    const featureGroup = featureGroupRef.current;
    leafletMap.addLayer(featureGroup);

    // Clear existing layers
    featureGroup.clearLayers();
    layerMapRef.current.clear();

    // Cancel any active move mode on re-render
    if (moveStateRef.current) {
      moveStateRef.current.cleanup();
      moveStateRef.current = null;
    }

    annotations.forEach((annotation) => {
      const { geoJson } = annotation;
      if (!geoJson) return;

      let layer: L.Layer | null = null;

      if (geoJson.type === 'Point') {
        const [lng, lat] = geoJson.coordinates as number[];
        layer = L.marker([lat, lng]);
      } else if (geoJson.type === 'LineString') {
        const latlngs = (geoJson.coordinates as number[][]).map(
          ([lng, lat]) => [lat, lng] as [number, number]
        );
        layer = L.polyline(latlngs, { color: '#2563eb', weight: 3 });
      } else if (geoJson.type === 'Polygon') {
        const ring = (geoJson.coordinates as number[][][])[0];
        const latlngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
        layer = L.polygon(latlngs, { color: '#2563eb', fillOpacity: 0.2 });
      }

      if (!layer) return;

      // Build popup as DOM nodes (not HTML strings) so user-controlled
      // fields cannot inject script. `textContent` is parsed as literal
      // text, not HTML.
      const popupEl = document.createElement('div');
      popupEl.className = 'annotation-popup';

      const h3 = document.createElement('h3');
      h3.textContent = annotation.title;
      popupEl.appendChild(h3);

      if (annotation.description) {
        const p = document.createElement('p');
        p.textContent = annotation.description;
        popupEl.appendChild(p);
      }

      if (annotation.media && annotation.media.length > 0) {
        const mediaDiv = document.createElement('div');
        mediaDiv.className = 'annotation-media';
        annotation.media.forEach((m) => {
          if (!isSafeMediaUrl(m.url)) return;
          if (m.mediaType === 'image') {
            const img = document.createElement('img');
            img.src = m.url;
            img.alt = m.caption || '';
            mediaDiv.appendChild(img);
          } else {
            const a = document.createElement('a');
            a.href = m.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = m.caption || m.url;
            mediaDiv.appendChild(a);
          }
        });
        popupEl.appendChild(mediaDiv);
      }

      const smallEl = document.createElement('small');
      smallEl.textContent = `By ${annotation.createdByUsername || 'unknown'}`;
      popupEl.appendChild(smallEl);

      const canActOnThis = canEdit && annotation.canEdit;
      if (canActOnThis) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'annotation-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-annotation';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', async () => {
          const newTitle = window.prompt('New title:', annotation.title);
          if (newTitle === null) return;
          const newDesc = window.prompt('New description:', annotation.description || '');

          try {
            await annotationsService.updateAnnotation(
              mapId, annotation.id,
              { title: newTitle, description: newDesc ?? '' },
              tenantId ?? undefined
            );
            updateAnnotationInStore({
              ...annotation,
              title: newTitle,
              description: newDesc ?? '',
            });
            layer!.closePopup();
          } catch {
            showMapError(leafletMap, 'Failed to update annotation.');
          }
        });
        actionsDiv.appendChild(editBtn);

        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn-move-annotation';
        moveBtn.textContent = 'Move';
        moveBtn.addEventListener('click', () => {
          layer!.closePopup();

          const mapContainer = leafletMap.getContainer();
          mapContainer.style.cursor = 'crosshair';

          const hint = document.createElement('div');
          hint.className = 'move-hint';
          hint.textContent = 'Click the new location (Esc to cancel)';
          mapContainer.appendChild(hint);

          const cancelMove = () => {
            mapContainer.style.cursor = '';
            hint.remove();
            leafletMap.off('click', onMapClick);
            document.removeEventListener('keydown', onKeyDown);
            moveStateRef.current = null;
          };

          const onMapClick = async (e: L.LeafletMouseEvent) => {
            cancelMove();

            const clickLng = e.latlng.lng;
            const clickLat = e.latlng.lat;
            const oldGeo = annotation.geoJson;
            let newGeoJson: GeoJsonGeometry;

            if (oldGeo.type === 'Point') {
              newGeoJson = { type: 'Point', coordinates: [clickLng, clickLat] };
            } else if (oldGeo.type === 'LineString') {
              const coords = oldGeo.coordinates as number[][];
              const cLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
              const cLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
              const dLng = clickLng - cLng;
              const dLat = clickLat - cLat;
              newGeoJson = {
                type: 'LineString',
                coordinates: coords.map(([lng, lat]) => [lng + dLng, lat + dLat]),
              };
            } else if (oldGeo.type === 'Polygon') {
              const ring = (oldGeo.coordinates as number[][][])[0];
              const cLng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
              const cLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
              const dLng = clickLng - cLng;
              const dLat = clickLat - cLat;
              newGeoJson = {
                type: 'Polygon',
                coordinates: [ring.map(([lng, lat]) => [lng + dLng, lat + dLat])],
              };
            } else {
              return;
            }

            try {
              await annotationsService.updateAnnotation(
                mapId, annotation.id,
                { geoJson: newGeoJson },
                tenantId ?? undefined
              );
              updateAnnotationInStore({
                ...annotation,
                geoJson: newGeoJson,
              });
            } catch {
              showMapError(leafletMap, 'Failed to move annotation.');
            }
          };

          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              cancelMove();
            }
          };

          leafletMap.once('click', onMapClick);
          document.addEventListener('keydown', onKeyDown);

          moveStateRef.current = { annotationId: annotation.id, cleanup: cancelMove };
        });
        actionsDiv.appendChild(moveBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete-annotation';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
          if (!window.confirm(`Delete "${annotation.title}"?`)) return;

          try {
            await annotationsService.deleteAnnotation(
              mapId, annotation.id, tenantId ?? undefined
            );
            removeAnnotationFromStore(annotation.id);
          } catch {
            showMapError(leafletMap, 'Failed to delete annotation.');
          }
        });
        actionsDiv.appendChild(deleteBtn);

        popupEl.appendChild(actionsDiv);
      }

      layer.bindPopup(popupEl);

      layer.on('click', () => setSelectedAnnotationId(annotation.id));

      featureGroup.addLayer(layer);
      layerMapRef.current.set(annotation.id, layer);
    });

    return () => {
      leafletMap.removeLayer(featureGroup);
    };
  }, [leafletMap, annotations, mapId, canEdit, tenantId,
      setSelectedAnnotationId, updateAnnotationInStore, removeAnnotationFromStore]);

  return null;
}

// eslint-disable-next-line react-refresh/only-export-components
export function layerToGeoJson(layer: L.Layer): GeoJsonGeometry | null {
  if (layer instanceof L.Marker) {
    const ll = layer.getLatLng();
    return { type: 'Point', coordinates: [ll.lng, ll.lat] };
  } else if (layer instanceof L.Polygon) {
    const latlngs = (layer.getLatLngs() as L.LatLng[][])[0];
    const coords = latlngs.map((ll) => [ll.lng, ll.lat]);
    coords.push(coords[0]);
    return { type: 'Polygon', coordinates: [coords] };
  } else if (layer instanceof L.Polyline) {
    const latlngs = layer.getLatLngs() as L.LatLng[];
    return { type: 'LineString', coordinates: latlngs.map((ll) => [ll.lng, ll.lat]) };
  }
  return null;
}
