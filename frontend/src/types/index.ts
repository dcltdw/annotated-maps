// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
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

// ─── Permissions ─────────────────────────────────────────────────────────────

export interface MapPermission {
  id: number;
  mapId: number;
  userId: number | null; // null = public
  username: string | null;
  canView: boolean;
  canEdit: boolean;
}

export interface SetPermissionRequest {
  userId: number | null; // null = public
  canView: boolean;
  canEdit: boolean;
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
