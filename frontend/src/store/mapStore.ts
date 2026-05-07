import { create } from 'zustand';
import type { MapRecord } from '@/types';

// Pared down for #92 — the annotation-shaped state is gone with the rebuild.
// Node and note state will be added back as #101 (map view rebuild) lands.

interface MapStore {
  maps: MapRecord[];
  setMaps: (maps: MapRecord[]) => void;

  activeMap: MapRecord | null;
  setActiveMap: (map: MapRecord | null) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  maps: [],
  setMaps: (maps) => set({ maps }),

  activeMap: null,
  setActiveMap: (map) => set({ activeMap: map }),
}));
