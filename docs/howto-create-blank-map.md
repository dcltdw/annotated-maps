# How to: Create a Blank Map

A **blank map** is a coordinate space with no backdrop image — just an
empty canvas of a fixed extent. Coordinates are arbitrary `(x, y)` units
within the extent. Use this for hand-drawn diagrams, conceptual
relationship maps, brainstorming surfaces, or any case where you want
the spatial layout but don't want a backdrop competing with the nodes.

If you want a real-world geographic map, see
[howto-create-wgs84-map.md](howto-create-wgs84-map.md). If you want a
backdrop image, see [howto-create-pixel-map.md](howto-create-pixel-map.md).

## Current limitation: API-only

> The "+ New Map" UI currently only creates WGS84 maps. Blank-map
> creation is exposed via the backend API but doesn't yet have a UI
> picker. The frontend rendering side fully supports blank maps once the
> map exists (see #128). A follow-up ticket will add the picker; until
> then, create blank maps via `curl` (or the equivalent in your scripting
> tool) as shown below.

## Prerequisites

- A registered account on the running app
- A logged-in JWT token (capture from `/auth/login` response)
- A decision on the canvas extent — how wide and tall should the
  coordinate space be? Common choices: `1000 × 1000` for small diagrams,
  `4000 × 3000` for a denser layout. The extent is just a number range;
  bigger doesn't cost more.

## Steps (API)

```bash
# Get token + tenantId from /auth/login (see flow-user-registration.md)
TOKEN="..."
TENANT_ID=...

curl -X POST "http://localhost:8080/api/v1/tenants/${TENANT_ID}/maps" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Project Brainstorm",
    "description": "Mapping the relationships between Phase 3 features",
    "coordinateSystem": {
      "type": "blank",
      "extent": { "x": 2000, "y": 1500 }
    }
  }'
```

Response includes the map id; navigate to
`/tenants/${TENANT_ID}/maps/${id}` to view. The frontend renders an empty
canvas of the requested extent. Add nodes to populate it.

## Coordinate-system fields reference

For a `blank` coordinate system the schema is:

| Field | Type | Notes |
|---|---|---|
| `type` | `"blank"` | Discriminator — must be exactly this string |
| `extent.x` | int > 0 | Width of the canvas. Coordinates run `x = 0..extent.x`. |
| `extent.y` | int > 0 | Height of the canvas. Coordinates run `y = 0..extent.y`. |

There is no viewport hint for blank maps — the frontend centers on
`(extent.x / 2, extent.y / 2)` at zoom 0 by default and clamps the
visible area to the extent's bounds.

## Coordinate convention

Same as pixel maps: Leaflet's `CRS.Simple` with bounds
`[[0, 0], [extent.y, extent.x]]`. The origin `(0, 0)` is at the top-left
and y increases *downward*. Node `geoJson.coordinates` for a Point on a
blank map is `[x, y]` in extent units.

## Verifying the map renders

After creation:

1. Navigate to `/tenants/${TENANT_ID}/maps/${id}` in the browser
2. You should see an empty bordered canvas (no image, no tile layer)
3. Add a node via the API or by clicking on the canvas (once #128's UI
   is wired). Confirm it renders at the expected position
4. Pan around — the visible area should clamp to the extent's bounds; you
   shouldn't be able to scroll into "negative space"
