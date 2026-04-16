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

export type TenantRole = 'admin' | 'editor' | 'viewer';

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

// ─── Maps ─────────────────────────────────────────────────────────────────────

export interface MapRecord {
  id: number;
  ownerId: number;
  ownerUsername: string;
  title: string;
  description: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  createdAt: string;
  updatedAt: string;
  permission: MapPermissionLevel;
}

export type MapPermissionLevel = 'none' | 'view' | 'edit' | 'owner';

export interface CreateMapRequest {
  title: string;
  description?: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
}

export interface UpdateMapRequest {
  title?: string;
  description?: string;
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
}

// ─── Annotations ─────────────────────────────────────────────────────────────

export type AnnotationType = 'marker' | 'polyline' | 'polygon';

export interface Annotation {
  id: number;
  mapId: number;
  createdBy: number;
  createdByUsername: string;
  type: AnnotationType;
  title: string;
  description: string;
  geoJson: GeoJsonGeometry;
  media: AnnotationMedia[];
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface GeoJsonGeometry {
  type: 'Point' | 'LineString' | 'Polygon';
  coordinates: number[] | number[][] | number[][][];
}

export interface AnnotationMedia {
  id: number;
  annotationId: number;
  mediaType: 'image' | 'link';
  url: string;
  caption: string;
}

export interface CreateAnnotationRequest {
  mapId: number;
  type: AnnotationType;
  title: string;
  description?: string;
  geoJson: GeoJsonGeometry;
}

export interface UpdateAnnotationRequest {
  title?: string;
  description?: string;
  geoJson?: GeoJsonGeometry;
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export type PermissionLevel = 'none' | 'view' | 'comment' | 'edit' | 'moderate' | 'admin';

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

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface Note {
  id: number;
  mapId: number;
  groupId: number | null;
  createdBy: number;
  createdByUsername: string;
  lat: number;
  lng: number;
  title: string | null;
  text: string;
  pinned: boolean;
  color: string | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteRequest {
  lat: number;
  lng: number;
  title?: string;
  text: string;
  color?: string;
  groupId?: number;
}

export interface UpdateNoteRequest {
  title?: string;
  text?: string;
  color?: string | null;
  groupId?: number | null;
  lat?: number;
  lng?: number;
}

// ─── Note Groups ──────────────────────────────────────────────────────────────

export interface NoteGroup {
  id: number;
  mapId: number;
  name: string;
  description: string;
  color: string;
  sortOrder: number;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteGroupRequest {
  name: string;
  description?: string;
  color?: string;
  sortOrder?: number;
}

export interface UpdateNoteGroupRequest {
  name?: string;
  description?: string;
  color?: string;
  sortOrder?: number;
}

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
