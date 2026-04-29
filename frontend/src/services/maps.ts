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
  NodeMediaListSchema,
  VisibilityGroupSchema,
  VisibilityGroupListSchema,
  VisibilityGroupMemberListSchema,
  NodeVisibilityStateSchema,
  NoteVisibilityStateSchema,
  type MapRecord,
  type MapList,
  type NodeRecord,
  type NodeList,
  type NodeSubtreeResponse,
  type NoteRecord,
  type NoteList,
  type NodeMediaList,
  type VisibilityGroup,
  type VisibilityGroupList,
  type VisibilityGroupMemberList,
  type CreateMapRequest,
  type UpdateMapRequest,
  type CreateNodeRequest,
  type UpdateNodeRequest,
  type CreateNoteRequest,
  type UpdateNoteRequest,
  type CreateVisibilityGroupRequest,
  type UpdateVisibilityGroupRequest,
  type NodeVisibilityState,
  type NoteVisibilityState,
  type SetVisibilityRequest,
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
    // The backend's PUT returns `{ id, updated: true }` (not the full record),
    // so re-fetch via GET to give callers the parsed MapRecord they expect.
    await apiClient.put(`${tenantBase(tenantId)}/maps/${mapId}`, data);
    return this.getMap(mapId, tenantId);
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

  async getVisibility(
    mapId: number,
    nodeId: number,
    tenantId?: number,
  ): Promise<NodeVisibilityState> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/visibility`,
    );
    return NodeVisibilityStateSchema.parse(res.data);
  },

  async setVisibility(
    mapId: number,
    nodeId: number,
    data: SetVisibilityRequest,
    tenantId?: number,
  ): Promise<void> {
    await apiClient.post(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/visibility`,
      data,
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

// ─── Visibility groups (#85 / #98) ───────────────────────────────────────────
// Auth model (server-enforced): tenant admin OR member of any group with
// manages_visibility=TRUE in the same tenant. Setting managesVisibility=true
// on POST/PUT is admin-only — managers can't bootstrap themselves into more
// power.

export const visibilityGroupsService = {
  async listGroups(tenantId?: number): Promise<VisibilityGroupList> {
    const res = await apiClient.get(`${tenantBase(tenantId)}/visibility-groups`);
    return VisibilityGroupListSchema.parse(res.data);
  },

  async createGroup(
    data: CreateVisibilityGroupRequest,
    tenantId?: number,
  ): Promise<VisibilityGroup> {
    const res = await apiClient.post(`${tenantBase(tenantId)}/visibility-groups`, data);
    return VisibilityGroupSchema.parse(res.data);
  },

  async updateGroup(
    groupId: number,
    data: UpdateVisibilityGroupRequest,
    tenantId?: number,
  ): Promise<VisibilityGroup> {
    const res = await apiClient.put(
      `${tenantBase(tenantId)}/visibility-groups/${groupId}`,
      data,
    );
    return VisibilityGroupSchema.parse(res.data);
  },

  async deleteGroup(groupId: number, tenantId?: number): Promise<void> {
    await apiClient.delete(`${tenantBase(tenantId)}/visibility-groups/${groupId}`);
  },

  async listMembers(
    groupId: number,
    tenantId?: number,
  ): Promise<VisibilityGroupMemberList> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/visibility-groups/${groupId}/members`,
    );
    return VisibilityGroupMemberListSchema.parse(res.data);
  },

  async addMember(groupId: number, userId: number, tenantId?: number): Promise<void> {
    await apiClient.post(
      `${tenantBase(tenantId)}/visibility-groups/${groupId}/members`,
      { userId },
    );
  },

  async removeMember(
    groupId: number,
    userId: number,
    tenantId?: number,
  ): Promise<void> {
    await apiClient.delete(
      `${tenantBase(tenantId)}/visibility-groups/${groupId}/members/${userId}`,
    );
  },
};

// ─── Node media ──────────────────────────────────────────────────────────────

export const nodeMediaService = {
  async listMedia(mapId: number, nodeId: number, tenantId?: number): Promise<NodeMediaList> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps/${mapId}/nodes/${nodeId}/media`
    );
    return NodeMediaListSchema.parse(res.data);
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

  async getVisibility(
    mapId: number,
    noteId: number,
    tenantId?: number,
  ): Promise<NoteVisibilityState> {
    const res = await apiClient.get(
      `${tenantBase(tenantId)}/maps/${mapId}/notes/${noteId}/visibility`,
    );
    return NoteVisibilityStateSchema.parse(res.data);
  },

  async setVisibility(
    mapId: number,
    noteId: number,
    data: SetVisibilityRequest,
    tenantId?: number,
  ): Promise<void> {
    await apiClient.post(
      `${tenantBase(tenantId)}/maps/${mapId}/notes/${noteId}/visibility`,
      data,
    );
  },
};
