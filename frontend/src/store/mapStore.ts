import { create } from 'zustand';
import type { MapRecord, Annotation } from '@/types';

interface MapStore {
  // Map list
  maps: MapRecord[];
  setMaps: (maps: MapRecord[]) => void;

  // Active map
  activeMap: MapRecord | null;
  setActiveMap: (map: MapRecord | null) => void;

  // Annotations for the active map
  annotations: Annotation[];
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (annotationId: number) => void;

  // UI state
  selectedAnnotationId: number | null;
  setSelectedAnnotationId: (id: number | null) => void;
  isDrawing: boolean;
  setIsDrawing: (drawing: boolean) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  maps: [],
  setMaps: (maps) => set({ maps }),

  activeMap: null,
  setActiveMap: (map) => set({ activeMap: map, annotations: [], selectedAnnotationId: null }),

  annotations: [],
  setAnnotations: (annotations) => set({ annotations }),
  addAnnotation: (annotation) =>
    set((state) => ({ annotations: [...state.annotations, annotation] })),
  updateAnnotation: (annotation) =>
    set((state) => ({
      annotations: state.annotations.map((a) => (a.id === annotation.id ? annotation : a)),
    })),
  removeAnnotation: (annotationId) =>
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== annotationId),
      selectedAnnotationId:
        state.selectedAnnotationId === annotationId ? null : state.selectedAnnotationId,
    })),

  selectedAnnotationId: null,
  setSelectedAnnotationId: (id) => set({ selectedAnnotationId: id }),

  isDrawing: false,
  setIsDrawing: (drawing) => set({ isDrawing: drawing }),
}));
