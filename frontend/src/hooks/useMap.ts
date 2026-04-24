import { useCallback } from 'react';
import { useMapStore } from '@/store/mapStore';
import { mapsService, annotationsService } from '@/services/maps';
import type { CreateMapRequest, UpdateMapRequest, CreateAnnotationRequest } from '@/types';

export function useMap() {
  const {
    maps,
    setMaps,
    activeMap,
    setActiveMap,
    annotations,
    setAnnotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    selectedAnnotationId,
    setSelectedAnnotationId,
    isDrawing,
    setIsDrawing,
  } = useMapStore();

  const loadMaps = useCallback(async () => {
    const response = await mapsService.listMaps();
    setMaps(response.data);
  }, [setMaps]);

  const loadMap = useCallback(
    async (mapId: number) => {
      const [map, anns] = await Promise.all([
        mapsService.getMap(mapId),
        annotationsService.listAnnotations(mapId),
      ]);
      setActiveMap(map);
      setAnnotations(anns);
    },
    [setActiveMap, setAnnotations]
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
      await mapsService.updateMap(mapId, data);
      // PUT returns {id, updated:true} only — re-fetch the row so we
      // pick up the server's authoritative title/description/updatedAt.
      const fresh = await mapsService.getMap(mapId);
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

  const createAnnotation = useCallback(
    async (data: CreateAnnotationRequest) => {
      const annotation = await annotationsService.createAnnotation(data);
      addAnnotation(annotation);
      return annotation;
    },
    [addAnnotation]
  );

  const deleteAnnotation = useCallback(
    async (mapId: number, annotationId: number) => {
      await annotationsService.deleteAnnotation(mapId, annotationId);
      removeAnnotation(annotationId);
    },
    [removeAnnotation]
  );

  return {
    maps,
    activeMap,
    annotations,
    selectedAnnotationId,
    isDrawing,
    setIsDrawing,
    setSelectedAnnotationId,
    loadMaps,
    loadMap,
    createMap,
    updateMap,
    deleteMap,
    createAnnotation,
    deleteAnnotation,
    updateAnnotation,
  };
}
