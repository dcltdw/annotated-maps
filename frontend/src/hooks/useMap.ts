import { useCallback } from 'react';
import { useMapStore } from '@/store/mapStore';
import { mapsService } from '@/services/maps';
import type { CreateMapRequest, UpdateMapRequest } from '@/types';

// Pared down for #92. Annotation-related callbacks are gone with the
// rebuild. Node + note loading will be added back when the map view
// rebuilds in #101.

export function useMap() {
  const { maps, setMaps, activeMap, setActiveMap } = useMapStore();

  const loadMaps = useCallback(async () => {
    const response = await mapsService.listMaps();
    setMaps(response.data);
  }, [setMaps]);

  const loadMap = useCallback(
    async (mapId: number) => {
      const map = await mapsService.getMap(mapId);
      setActiveMap(map);
    },
    [setActiveMap]
  );

  const createMap = useCallback(
    async (data: CreateMapRequest) => {
      const map = await mapsService.createMap(data);
      setMaps([...maps, map]);
      return map;
    },
    [maps, setMaps]
  );

  const updateMap = useCallback(
    async (mapId: number, data: UpdateMapRequest) => {
      // mapsService.updateMap returns the freshly-parsed MapRecord.
      const fresh = await mapsService.updateMap(mapId, data);
      setActiveMap(fresh);
      setMaps(maps.map((m) => (m.id === mapId ? fresh : m)));
      return fresh;
    },
    [maps, setMaps, setActiveMap]
  );

  const deleteMap = useCallback(
    async (mapId: number) => {
      await mapsService.deleteMap(mapId);
      setMaps(maps.filter((m) => m.id !== mapId));
      setActiveMap(null);
    },
    [maps, setMaps, setActiveMap]
  );

  return {
    maps,
    activeMap,
    loadMaps,
    loadMap,
    createMap,
    updateMap,
    deleteMap,
  };
}
