// Hand-written types for the parts of the API not yet covered by Zod
// schemas (auth, tenants, permissions). The map / node / note / coordinate-
// system shapes — the ones that changed during the rebuild — live in
// `api/schemas.ts` and are derived from Zod via `z.infer<>`. New code
// should prefer importing types from `@/api/schemas` over redefining here.

// Re-export the Zod-derived types so consumers can keep importing from
// `@/types` if they prefer a single import surface.
export type {
  MapRecord,
  MapList,
  MapPermissionLevel,
  CoordinateSystem,
  NodeRecord,
  NodeList,
  NodeSubtreeEntry,
  NodeSubtreeResponse,
  NoteRecord,
  NoteList,
  NodeMediaRecord,
  NodeMediaList,
  NodeMediaType,
  VisibilityGroup,
  VisibilityGroupList,
  VisibilityGroupMember,
  VisibilityGroupMemberList,
  CreateVisibilityGroupRequest,
  UpdateVisibilityGroupRequest,
  NodeVisibilityState,
  NoteVisibilityState,
  SetVisibilityRequest,
  GeoJsonGeometry,
  TenantRole,
  PermissionLevel,
  CreateMapRequest,
  UpdateMapRequest,
  CreateNodeRequest,
  UpdateNodeRequest,
  CreateNoteRequest,
  UpdateNoteRequest,
} from '@/api/schemas';

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  orgId: number | null;
  tenantId: number | null;
  tenants: TenantSummary[];
  branding: TenantBranding;
  isAuthenticated: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  orgId: number;
  tenantId: number;
  tenants: TenantSummary[];
}

// ─── Organizations & Tenants ─────────────────────────────────────────────────

export interface Organization {
  id: number;
  name: string;
  slug: string;
}

import type { TenantRole } from '@/api/schemas';

export interface TenantSummary {
  id: number;
  name: string;
  slug: string;
  role: TenantRole;
}

export interface Tenant {
  id: number;
  orgId: number;
  orgName: string;
  orgSlug: string;
  name: string;
  slug: string;
  role: TenantRole;
}

export interface TenantBranding {
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
  display_name?: string;
}

export interface TenantMember {
  userId: number;
  username: string;
  email: string;
  role: TenantRole;
  createdAt: string;
}

// ─── Map permissions ─────────────────────────────────────────────────────────

import type { PermissionLevel } from '@/api/schemas';

export interface MapPermission {
  id: number;
  mapId: number;
  userId: number | null;
  username: string | null;
  level: PermissionLevel;
}

export interface SetPermissionRequest {
  userId: number | null;
  level: PermissionLevel;
}

export type UserStatus = 'active' | 'suspended' | 'deactivated' | 'pending' | 'locked';
export type PlatformRole = 'superuser' | 'support' | 'none';
export type OrgRole = 'owner' | 'admin' | 'member';

// ─── API ─────────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
