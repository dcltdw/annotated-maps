import { apiClient } from './api';
import { useAuthStore } from '@/store/authStore';
import {
  MapRecordSchema,
  MapListSchema,
  NodeRecordSchema,
  NodeListSchema,
  NodeSubtreeResponseSchema,
  NoteRecordSchema,
  NoteListSchema,
  type MapRecord,
  type MapList,
  type NodeRecord,
  type NodeList,
  type NodeSubtreeResponse,
  type NoteRecord,
  type NoteList,
  type CreateMapRequest,
  type UpdateMapRequest,
  type CreateNodeRequest,
  type UpdateNodeRequest,
  type CreateNoteRequest,
  type UpdateNoteRequest,
} from '@/api/schemas';
import type {
  Tenant,
  TenantBranding,
  TenantMember,
  MapPermission,
  SetPermissionRequest,
} from '@/types';

// Helper: resolve tenantId from store if not explicitly provided.
function tenantBase(tenantId?: number): string {
  const id = tenantId ?? useAuthStore.getState().tenantId;
  if (!id) throw new Error('No active tenant');
  return `/tenants/${id}`;
}

// ─── Tenants ──────────────────────────────────────────────────────────────────
// Tenant shapes were already typed by hand and kept as-is for #92. A future
// ticket can extend api/schemas.ts to cover them.

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
// Each call parses through the Zod schema — the caller gets inferred-typed
// data, and a malformed response throws an actionable ZodError before the
// component sees it.

export const mapsService = {
  async listMaps(page = 1, pageSize = 20, tenantId?: number): Promise<MapList> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps`,
      { params: { page, pageSize } }
    );
    return MapListSchema.parse(res.data);
  },

  async getMap(mapId: number, tenantId?: number): Promise<MapRecord> {
    const res = await apiClient.get(`${tenantBase(tenantId)}/maps/${mapId}`);
    return MapRecordSchema.parse(res.data);
  },

  async createMap(data: CreateMapRequest, tenantId?: number): Promise<MapRecord> {
    const res = await apiClient.post(`${tenantBase(tenantId)}/maps`, data);
    return MapRecordSchema.parse(res.data);
  },

  async updateMap(mapId: number, data: UpdateMapRequest, tenantId?: number): Promise<MapRecord> {
    const res = await apiClient.put(`${tenantBase(tenantId)}/maps/${mapId}`, data);
    return MapRecordSchema.parse(res.data);
  },

  async deleteMap(mapId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(`${tenantBase(tenantId)}/maps/${mapId}`);
  },
};

// ─── Nodes (replaces the old annotations service) ────────────────────────────

export const nodesService = {
  async listNodes(mapId: number, parentId?: number | null, tenantId?: number): Promise<NodeList> {
    // parentId === null → top-level only (server reads empty parentId param)
    // parentId === undefined → all nodes
    const params: Record<string, string> = {};
    if (parentId === null) params.parentId = '';
    else if (parentId !== undefined) params.parentId = String(parentId);
    const res = await apiClient.get(`${tenantBase(tenantId)}/maps/${mapId}/nodes`, { params });
    return NodeListSchema.parse(res.data);
  },

  async getNode(mapId: number, nodeId: number, tenantId?: number): Promise<NodeRecord> {
    const res = await apiClient.get(`${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}`);
    return NodeRecordSchema.parse(res.data);
  },

  async createNode(mapId: number, data: CreateNodeRequest, tenantId?: number): Promise<NodeRecord> {
    const res = await apiClient.post(`${tenantBase(tenantId)}/maps/${mapId}/nodes`, data);
    return NodeRecordSchema.parse(res.data);
  },

  async updateNode(
    mapId: number,
    nodeId: number,
    data: UpdateNodeRequest,
    tenantId?: number
  ): Promise<void> {
    await apiClient.put(`${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}`, data);
  },

  async deleteNode(mapId: number, nodeId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(`${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}`);
  },

  async listChildren(mapId: number, nodeId: number, tenantId?: number): Promise<NodeList> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/children`
    );
    return NodeListSchema.parse(res.data);
  },

  async getSubtree(
    mapId: number,
    nodeId: number,
    opts?: { limit?: number; cursor?: number },
    tenantId?: number
  ): Promise<NodeSubtreeResponse> {
    const params: Record<string, string> = {};
    if (opts?.limit !== undefined) params.limit = String(opts.limit);
    if (opts?.cursor !== undefined) params.cursor = String(opts.cursor);
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/subtree`,
      { params }
    );
    return NodeSubtreeResponseSchema.parse(res.data);
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

// ─── Notes (now node-attached, no own coordinates) ───────────────────────────

export const notesService = {
  async listNotesForNode(
    mapId: number,
    nodeId: number,
    tenantId?: number
  ): Promise<NoteList> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/notes`
    );
    return NoteListSchema.parse(res.data);
  },

  async getNote(mapId: number, noteId: number, tenantId?: number): Promise<NoteRecord> {
    const res = await apiClient.get(`${tenantBase(tenantId)}/maps/${mapId}/notes/${noteId}`);
    return NoteRecordSchema.parse(res.data);
  },

  async createNote(
    mapId: number,
    nodeId: number,
    data: CreateNoteRequest,
    tenantId?: number
  ): Promise<NoteRecord> {
    const res = await apiClient.post(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/notes`,
      data
    );
    return NoteRecordSchema.parse(res.data);
  },

  async updateNote(
    mapId: number,
    noteId: number,
    data: UpdateNoteRequest,
    tenantId?: number
  ): Promise<void> {
    await apiClient.put(`${tenantBase(tenantId)}/maps/${mapId}/notes/${noteId}`, data);
  },

  async deleteNote(mapId: number, noteId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(`${tenantBase(tenantId)}/maps/${mapId}/notes/${noteId}`);
  },
};
