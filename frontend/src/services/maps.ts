import { apiClient } from './api';
import type {
  MapRecord,
  CreateMapRequest,
  Annotation,
  CreateAnnotationRequest,
  AnnotationMedia,
  MapPermission,
  SetPermissionRequest,
  PaginatedResponse,
} from '@/types';

// ─── Maps ─────────────────────────────────────────────────────────────────────

export const mapsService = {
  async listMaps(page = 1, pageSize = 20): Promise<PaginatedResponse<MapRecord>> {
    const res = await apiClient.get<PaginatedResponse<MapRecord>>('/maps', {
      params: { page, pageSize },
    });
    return res.data;
  },

  async getMap(mapId: number): Promise<MapRecord> {
    const res = await apiClient.get<MapRecord>(`/maps/${mapId}`);
    return res.data;
  },

  async createMap(data: CreateMapRequest): Promise<MapRecord> {
    const res = await apiClient.post<MapRecord>('/maps', data);
    return res.data;
  },

  async updateMap(mapId: number, data: Partial<CreateMapRequest>): Promise<MapRecord> {
    const res = await apiClient.put<MapRecord>(`/maps/${mapId}`, data);
    return res.data;
  },

  async deleteMap(mapId: number): Promise<void> {
    await apiClient.delete(`/maps/${mapId}`);
  },
};

// ─── Annotations ─────────────────────────────────────────────────────────────

export const annotationsService = {
  async listAnnotations(mapId: number): Promise<Annotation[]> {
    const res = await apiClient.get<Annotation[]>(`/maps/${mapId}/annotations`);
    return res.data;
  },

  async getAnnotation(mapId: number, annotationId: number): Promise<Annotation> {
    const res = await apiClient.get<Annotation>(`/maps/${mapId}/annotations/${annotationId}`);
    return res.data;
  },

  async createAnnotation(data: CreateAnnotationRequest): Promise<Annotation> {
    const res = await apiClient.post<Annotation>(`/maps/${data.mapId}/annotations`, data);
    return res.data;
  },

  async updateAnnotation(
    mapId: number,
    annotationId: number,
    data: Partial<CreateAnnotationRequest>
  ): Promise<Annotation> {
    const res = await apiClient.put<Annotation>(
      `/maps/${mapId}/annotations/${annotationId}`,
      data
    );
    return res.data;
  },

  async deleteAnnotation(mapId: number, annotationId: number): Promise<void> {
    await apiClient.delete(`/maps/${mapId}/annotations/${annotationId}`);
  },

  // Media attachments
  async addMedia(
    mapId: number,
    annotationId: number,
    formData: FormData
  ): Promise<AnnotationMedia> {
    const res = await apiClient.post<AnnotationMedia>(
      `/maps/${mapId}/annotations/${annotationId}/media`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return res.data;
  },

  async deleteMedia(mapId: number, annotationId: number, mediaId: number): Promise<void> {
    await apiClient.delete(`/maps/${mapId}/annotations/${annotationId}/media/${mediaId}`);
  },
};

// ─── Permissions ─────────────────────────────────────────────────────────────

export const permissionsService = {
  async listPermissions(mapId: number): Promise<MapPermission[]> {
    const res = await apiClient.get<MapPermission[]>(`/maps/${mapId}/permissions`);
    return res.data;
  },

  async setPermission(mapId: number, data: SetPermissionRequest): Promise<MapPermission> {
    const res = await apiClient.put<MapPermission>(`/maps/${mapId}/permissions`, data);
    return res.data;
  },

  async removePermission(mapId: number, userId: number | null): Promise<void> {
    const target = userId === null ? 'public' : String(userId);
    await apiClient.delete(`/maps/${mapId}/permissions/${target}`);
  },
};
