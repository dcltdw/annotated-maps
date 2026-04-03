import { useEffect, useRef } from 'react';
import { useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import type { Note, NoteGroup } from '@/types';

interface NoteMarkersProps {
  notes: Note[];
  groups: NoteGroup[];
  onNoteClick?: (note: Note) => void;
}

const DEFAULT_NOTE_COLOR = '#00FFFF'; // cyan — distinct from blue annotation pins

function getNoteColor(note: Note, groups: NoteGroup[]): string {
  // Priority: per-note color > group color > default
  if (note.color) return note.color;
  if (note.groupId) {
    const group = groups.find((g) => g.id === note.groupId);
    if (group?.color) return group.color;
  }
  return DEFAULT_NOTE_COLOR;
}

export function NoteMarkers({ notes, groups, onNoteClick }: NoteMarkersProps) {
  const leafletMap = useLeafletMap();
  const layerGroupRef = useRef<L.LayerGroup>(new L.LayerGroup());

  useEffect(() => {
    const layerGroup = layerGroupRef.current;
    leafletMap.addLayer(layerGroup);
    layerGroup.clearLayers();

    notes.forEach((note) => {
      // Skip notes at 0,0 (unplaced)
      if (note.lat === 0 && note.lng === 0) return;

      const color = getNoteColor(note, groups);

      const marker = L.circleMarker([note.lat, note.lng], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      });

      const popupContent = `
        <div class="note-popup">
          ${note.title ? `<h4>${note.title}</h4>` : ''}
          <p>${note.text}</p>
          <small>By ${note.createdByUsername || 'unknown'}</small>
        </div>
      `;
      marker.bindPopup(popupContent);

      marker.on('click', () => {
        onNoteClick?.(note);
      });

      layerGroup.addLayer(marker);
    });

    return () => {
      leafletMap.removeLayer(layerGroup);
    };
  }, [leafletMap, notes, groups, onNoteClick]);

  return null;
}
