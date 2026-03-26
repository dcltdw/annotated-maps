import { useEffect } from 'react';
import { useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore } from '@/store/mapStore';
import type { Annotation } from '@/types';

interface AnnotationLayerProps {
  mapId: number;
  canEdit: boolean;
}

function annotationToLayer(annotation: Annotation): L.Layer | null {
  const { geoJson } = annotation;

  const popupContent = `
    <div class="annotation-popup">
      <h3>${annotation.title}</h3>
      ${annotation.description ? `<p>${annotation.description}</p>` : ''}
      ${
        annotation.media.length > 0
          ? `<div class="annotation-media">
          ${annotation.media
            .map((m) =>
              m.mediaType === 'image'
                ? `<img src="${m.url}" alt="${m.caption}" />`
                : `<a href="${m.url}" target="_blank">${m.caption || m.url}</a>`
            )
            .join('')}
        </div>`
          : ''
      }
      <small>By ${annotation.createdByUsername}</small>
    </div>
  `;

  if (geoJson.type === 'Point') {
    const [lng, lat] = geoJson.coordinates as number[];
    return L.marker([lat, lng]).bindPopup(popupContent);
  } else if (geoJson.type === 'LineString') {
    const latlngs = (geoJson.coordinates as number[][]).map(([lng, lat]) => [lat, lng] as [number, number]);
    return L.polyline(latlngs, { color: '#2563eb', weight: 3 }).bindPopup(popupContent);
  } else if (geoJson.type === 'Polygon') {
    const ring = (geoJson.coordinates as number[][][])[0];
    const latlngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
    return L.polygon(latlngs, { color: '#2563eb', fillOpacity: 0.2 }).bindPopup(popupContent);
  }

  return null;
}

export function AnnotationLayer({ mapId: _mapId, canEdit: _canEdit }: AnnotationLayerProps) {
  const leafletMap = useLeafletMap();
  const annotations = useMapStore((s) => s.annotations);
  const setSelectedAnnotationId = useMapStore((s) => s.setSelectedAnnotationId);

  useEffect(() => {
    const layerGroup = L.layerGroup().addTo(leafletMap);

    annotations.forEach((annotation) => {
      const layer = annotationToLayer(annotation);
      if (!layer) return;

      layer.on('click', () => setSelectedAnnotationId(annotation.id));
      layerGroup.addLayer(layer);
    });

    return () => {
      leafletMap.removeLayer(layerGroup);
    };
  }, [leafletMap, annotations, setSelectedAnnotationId]);

  return null;
}
