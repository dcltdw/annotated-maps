// Phase 2g foundation (#92): runtime-validated Zod schemas at the API
// boundary. Services in `services/maps.ts` (and elsewhere) parse responses
// through these schemas — tsc gets the inferred type, the runtime gets a
// guarantee. Hand-written types in `types/index.ts` are derived from
// these via `z.infer<>`.
//
// Scope (per #92): MapRecord, NodeRecord, NoteRecord, CoordinateSystem.
// Auth shapes were already typed by hand and are kept that way for now;
// the broader API surface (visibility groups, plots, members) lives behind
// later tickets that will add their own schemas as they're touched.

import { z } from 'zod';

// ─── Shared ──────────────────────────────────────────────────────────────────

export const TenantRoleSchema = z.enum(['admin', 'editor', 'viewer']);
export type TenantRole = z.infer<typeof TenantRoleSchema>;

export const PermissionLevelSchema = z.enum([
  'none', 'view', 'comment', 'edit', 'moderate', 'admin',
]);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

// Map-record `permission` is the caller's own access — narrower than the
// server-side level enum.
export const MapPermissionLevelSchema = z.enum(['none', 'view', 'edit', 'owner']);
export type MapPermissionLevel = z.infer<typeof MapPermissionLevelSchema>;

// ─── Coordinate system (discriminated union) ─────────────────────────────────
// Mirrors the validator in MapController.cpp. Three types; the discriminator
// is `type`. Backends that send unknown types will fail parse — by design,
// since we'd have no renderer for them.

export const Wgs84CoordinateSystemSchema = z.object({
  type: z.literal('wgs84'),
  center: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  zoom: z.number(),
});

export const PixelCoordinateSystemSchema = z.object({
  type: z.literal('pixel'),
  image_url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    zoom: z.number(),
  }),
});

export const BlankCoordinateSystemSchema = z.object({
  type: z.literal('blank'),
  extent: z.object({
    x: z.number().int().positive(),
    y: z.number().int().positive(),
  }),
});

export const CoordinateSystemSchema = z.discriminatedUnion('type', [
  Wgs84CoordinateSystemSchema,
  PixelCoordinateSystemSchema,
  BlankCoordinateSystemSchema,
]);
export type CoordinateSystem = z.infer<typeof CoordinateSystemSchema>;

// ─── Maps ────────────────────────────────────────────────────────────────────

export const MapRecordSchema = z.object({
  id: z.number().int(),
  ownerId: z.number().int(),
  ownerUsername: z.string(),
  title: z.string(),
  description: z.string(),
  coordinateSystem: CoordinateSystemSchema,
  ownerXray: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  permission: MapPermissionLevelSchema,
});
export type MapRecord = z.infer<typeof MapRecordSchema>;

export const MapListSchema = z.object({
  data: z.array(MapRecordSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type MapList = z.infer<typeof MapListSchema>;

// ─── GeoJSON (used by nodes) ─────────────────────────────────────────────────
// The backend accepts Point / LineString / Polygon. Coordinates are deliberately
// loosely-typed at the API boundary — the map's coordinate_system declares
// what the numbers mean (WGS84 lat/lng vs pixel x/y vs blank-canvas units).

export const GeoJsonGeometrySchema = z.object({
  type: z.enum(['Point', 'LineString', 'Polygon']),
  coordinates: z.unknown(),
});
export type GeoJsonGeometry = z.infer<typeof GeoJsonGeometrySchema>;

// ─── Nodes ───────────────────────────────────────────────────────────────────
// Tree-structured place markers (replaced annotations during the rebuild).

export const NodeRecordSchema = z.object({
  id: z.number().int(),
  mapId: z.number().int(),
  parentId: z.number().int().nullable(),
  name: z.string(),
  geoJson: GeoJsonGeometrySchema.nullable(),
  description: z.string(),
  color: z.string().nullable(),
  visibilityOverride: z.boolean(),
  createdBy: z.number().int(),
  createdByUsername: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NodeRecord = z.infer<typeof NodeRecordSchema>;

export const NodeListSchema = z.array(NodeRecordSchema);
export type NodeList = z.infer<typeof NodeListSchema>;

// Subtree response (#89) carries an extra `depth` per entry plus a
// nextCursor for pagination.
export const NodeSubtreeEntrySchema = NodeRecordSchema.extend({
  depth: z.number().int().nonnegative(),
});
export type NodeSubtreeEntry = z.infer<typeof NodeSubtreeEntrySchema>;

export const NodeSubtreeResponseSchema = z.object({
  nodes: z.array(NodeSubtreeEntrySchema),
  nextCursor: z.number().int().nullable(),
});
export type NodeSubtreeResponse = z.infer<typeof NodeSubtreeResponseSchema>;

// ─── Notes ───────────────────────────────────────────────────────────────────
// Notes attach to a node (note.node_id), not to a map directly. Position is
// inherited from the attached node — no own lat/lng/x/y.

export const NoteRecordSchema = z.object({
  id: z.number().int(),
  nodeId: z.number().int(),
  mapId: z.number().int(),
  createdBy: z.number().int(),
  createdByUsername: z.string(),
  title: z.string(),
  text: z.string(),
  pinned: z.boolean(),
  color: z.string().nullable(),
  visibilityOverride: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
});
export type NoteRecord = z.infer<typeof NoteRecordSchema>;

export const NoteListSchema = z.array(NoteRecordSchema);
export type NoteList = z.infer<typeof NoteListSchema>;

// ─── Request shapes (used by service callers) ────────────────────────────────
// These don't need runtime parsing on the way out — they're typed for the
// caller's convenience. Re-exported from this module so all schema-derived
// types live in one place.

export type CreateMapRequest = {
  title: string;
  description?: string;
  coordinateSystem?: CoordinateSystem;
};

export type UpdateMapRequest = Partial<CreateMapRequest>;

export type CreateNodeRequest = {
  name: string;
  parentId?: number;
  geoJson?: GeoJsonGeometry;
  description?: string;
  color?: string;
};

export type UpdateNodeRequest = Partial<Omit<CreateNodeRequest, 'parentId'>>;

export type CreateNoteRequest = {
  title?: string;
  text: string;
  color?: string;
  pinned?: boolean;
};

export type UpdateNoteRequest = Partial<CreateNoteRequest>;
