import { useEffect, useRef } from 'react';
import { useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore } from '@/store/mapStore';
import { useAuthStore } from '@/store/authStore';
import { annotationsService } from '@/services/maps';
import type { Annotation, GeoJsonGeometry } from '@/types';

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

function createPopupContent(annotation: Annotation, canEdit: boolean): string {
  const mediaHtml = annotation.media && annotation.media.length > 0
    ? `<div class="annotation-media">
        ${annotation.media
          .map((m) =>
            m.mediaType === 'image'
              ? `<img src="${m.url}" alt="${m.caption || ''}" />`
              : `<a href="${m.url}" target="_blank">${m.caption || m.url}</a>`
          )
          .join('')}
      </div>`
    : '';

  const editButtons = canEdit
    ? `<div class="annotation-actions">
        <button class="btn-edit-annotation" data-id="${annotation.id}">Edit</button>
        <button class="btn-move-annotation" data-id="${annotation.id}">Move</button>
        <button class="btn-delete-annotation" data-id="${annotation.id}">Delete</button>
      </div>`
    : '';

  return `
    <div class="annotation-popup">
      <h3>${annotation.title}</h3>
      ${annotation.description ? `<p>${annotation.description}</p>` : ''}
      ${mediaHtml}
      <small>By ${annotation.createdByUsername || 'unknown'}</small>
      ${editButtons}
    </div>
  `;
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

      (layer as unknown as Record<string, unknown>)._annotationId = annotation.id;

      const popup = createPopupContent(annotation, canEdit && annotation.canEdit);
      layer.bindPopup(popup);

      layer.on('click', () => setSelectedAnnotationId(annotation.id));

      layer.on('popupopen', () => {
        const container = layer!.getPopup()?.getElement();
        if (!container) return;

        // ─── Edit button ─────────────────────────────────────────────
        const editBtn = container.querySelector('.btn-edit-annotation');
        editBtn?.addEventListener('click', async () => {
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

        // ─── Move button (markers only) ──────────────────────────────
        const moveBtn = container.querySelector('.btn-move-annotation');
        moveBtn?.addEventListener('click', () => {
          layer!.closePopup();

          // Enter move mode: change cursor, listen for next map click
          const mapContainer = leafletMap.getContainer();
          mapContainer.style.cursor = 'crosshair';

          // Show a toast/hint
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
              // Compute centroid
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

        // ─── Delete button ───────────────────────────────────────────
        const deleteBtn = container.querySelector('.btn-delete-annotation');
        deleteBtn?.addEventListener('click', async () => {
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
      });

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
