import { apiClient } from './api';
import { useAuthStore } from '@/store/authStore';
import type {
  MapRecord,
  CreateMapRequest,
  Annotation,
  CreateAnnotationRequest,
  AnnotationMedia,
  MapPermission,
  SetPermissionRequest,
  TenantBranding,
  PaginatedResponse,
  Tenant,
  TenantMember,
} from '@/types';

// Helper: resolve tenantId from store if not explicitly provided
function tenantBase(tenantId?: number): string {
  const id = tenantId ?? useAuthStore.getState().tenantId;
  if (!id) throw new Error('No active tenant');
  return `/tenants/${id}`;
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

export const tenantsService = {
  async listTenants(): Promise<Tenant[]> {
    const res = await apiClient.get<Tenant[]>('/tenants');
    return res.data;
  },

  async listMembers(tenantId: number): Promise<TenantMember[]> {
    const res = await apiClient.get<TenantMember[]>(`/tenants/${tenantId}/members`);
    return res.data;
  },

  async addMember(
    tenantId: number,
    userId: number,
    role: string
  ): Promise<{ userId: number; role: string; added: boolean }> {
    const res = await apiClient.post(`/tenants/${tenantId}/members`, { userId, role });
    return res.data;
  },

  async removeMember(tenantId: number, userId: number): Promise<void> {
    await apiClient.delete(`/tenants/${tenantId}/members/${userId}`);
  },

  async getBranding(tenantId: number): Promise<TenantBranding> {
    const res = await apiClient.get<TenantBranding>(`/tenants/${tenantId}/branding`);
    return res.data;
  },

  async updateBranding(tenantId: number, branding: TenantBranding): Promise<TenantBranding> {
    const res = await apiClient.put<TenantBranding>(`/tenants/${tenantId}/branding`, branding);
    return res.data;
  },
};

// ─── Maps ─────────────────────────────────────────────────────────────────────

export const mapsService = {
  async listMaps(page = 1, pageSize = 20, tenantId?: number): Promise<PaginatedResponse<MapRecord>> {
    const res = await apiClient.get<PaginatedResponse<MapRecord>>(
      `${tenantBase(tenantId)}/maps`,
      { params: { page, pageSize } }
    );
    return res.data;
  },

  async getMap(mapId: number, tenantId?: number): Promise<MapRecord> {
    const res = await apiClient.get<MapRecord>(`${tenantBase(tenantId)}/maps/${mapId}`);
    return res.data;
  },

  async createMap(data: CreateMapRequest, tenantId?: number): Promise<MapRecord> {
    const res = await apiClient.post<MapRecord>(`${tenantBase(tenantId)}/maps`, data);
    return res.data;
  },

  async updateMap(mapId: number, data: Partial<CreateMapRequest>, tenantId?: number): Promise<MapRecord> {
    const res = await apiClient.put<MapRecord>(`${tenantBase(tenantId)}/maps/${mapId}`, data);
    return res.data;
  },

  async deleteMap(mapId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(`${tenantBase(tenantId)}/maps/${mapId}`);
  },
};

// ─── Annotations ─────────────────────────────────────────────────────────────

export const annotationsService = {
  async listAnnotations(mapId: number, tenantId?: number): Promise<Annotation[]> {
    const res = await apiClient.get<Annotation[]>(`${tenantBase(tenantId)}/maps/${mapId}/annotations`);
    return res.data;
  },

  async getAnnotation(mapId: number, annotationId: number, tenantId?: number): Promise<Annotation> {
    const res = await apiClient.get<Annotation>(
      `${tenantBase(tenantId)}/maps/${mapId}/annotations/${annotationId}`
    );
    return res.data;
  },

  async createAnnotation(data: CreateAnnotationRequest, tenantId?: number): Promise<Annotation> {
    const res = await apiClient.post<Annotation>(
      `${tenantBase(tenantId)}/maps/${data.mapId}/annotations`,
      data
    );
    return res.data;
  },

  async updateAnnotation(
    mapId: number,
    annotationId: number,
    data: Partial<CreateAnnotationRequest>,
    tenantId?: number
  ): Promise<Annotation> {
    const res = await apiClient.put<Annotation>(
      `${tenantBase(tenantId)}/maps/${mapId}/annotations/${annotationId}`,
      data
    );
    return res.data;
  },

  async deleteAnnotation(mapId: number, annotationId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(`${tenantBase(tenantId)}/maps/${mapId}/annotations/${annotationId}`);
  },

  async addMedia(
    mapId: number,
    annotationId: number,
    data: { mediaType: string; url: string; caption?: string },
    tenantId?: number
  ): Promise<AnnotationMedia> {
    const res = await apiClient.post<AnnotationMedia>(
      `${tenantBase(tenantId)}/maps/${mapId}/annotations/${annotationId}/media`,
      data
    );
    return res.data;
  },

  async deleteMedia(mapId: number, annotationId: number, mediaId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(
      `${tenantBase(tenantId)}/maps/${mapId}/annotations/${annotationId}/media/${mediaId}`
    );
  },
};

// ─── Permissions ─────────────────────────────────────────────────────────────

export const permissionsService = {
  async listPermissions(mapId: number, tenantId?: number): Promise<MapPermission[]> {
    const res = await apiClient.get<MapPermission[]>(`${tenantBase(tenantId)}/maps/${mapId}/permissions`);
    return res.data;
  },

  async setPermission(mapId: number, data: SetPermissionRequest, tenantId?: number): Promise<MapPermission> {
    const res = await apiClient.put<MapPermission>(
      `${tenantBase(tenantId)}/maps/${mapId}/permissions`,
      data
    );
    return res.data;
  },

  async removePermission(mapId: number, userId: number | null, tenantId?: number): Promise<void> {
    const target = userId === null ? 'public' : String(userId);
    await apiClient.delete(`${tenantBase(tenantId)}/maps/${mapId}/permissions/${target}`);
  },
};
