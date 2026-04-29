import type { MapRecord } from '@/types';

// TODO(#101): rebuild the map view to render nodes by geometry, dispatch
// on coordinateSystem.type (wgs84 / pixel / blank), drop leaflet-draw, and
// wire click-to-select. This stub keeps `tsc --noEmit` happy on the way out
// of #92 (Zod foundation) without committing to the old leaflet-draw shape.

interface MapViewProps {
  map: MapRecord;
}

export function MapView({ map }: MapViewProps) {
  return (
    <div className="map-view-stub">
      <p>
        <strong>Map view: rebuild in progress.</strong>
      </p>
      <p>
        Map <em>{map.title}</em> uses coordinate system <code>{map.coordinateSystem.type}</code>.
        The interactive renderer lands in #101.
      </p>
    </div>
  );
}
