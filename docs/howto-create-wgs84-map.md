# How to: Create a WGS84 Map

A **WGS84 map** is a real-world map backed by an OpenStreetMap tile layer.
Coordinates are latitude / longitude in standard WGS84 (the same coordinate
system Google Maps uses). Use this when you're annotating real geography:
hiking trails, neighborhood walks, cross-continent travel diaries.

If you need a non-geographic backdrop (a game-world map image, a building
floor plan, an empty whiteboard), see
[howto-create-pixel-map.md](howto-create-pixel-map.md) or
[howto-create-blank-map.md](howto-create-blank-map.md) instead.

## Prerequisites

- A registered account on the running app (see
  [flow-user-registration.md](flow-user-registration.md))
- Logged in (the app drops you on `/tenants/{your-tenant-id}/maps` after
  login)

## Steps (UI)

1. From the **My Maps** page, click **+ New Map** in the top-right.
2. In the modal, fill in:
   - **Title** — e.g. "Catskills Hikes 2026"
   - **Description** *(optional)* — any free-form text
3. Click **Create**.
4. The app navigates you to the new map's detail page at
   `/tenants/{tid}/maps/{mid}`. The map opens centered on `lat=0, lng=0`
   at zoom level 3 (a wide view of the equator). Pan and zoom to your
   region of interest before adding nodes.

That's it — the map is ready for nodes (places, lines, polygons), notes,
plots, and visibility tagging.

## What the UI sends to the backend

The form constructs this `CreateMapRequest`:

```json
{
  "title": "Your Title",
  "description": "Your Description",
  "coordinateSystem": {
    "type": "wgs84",
    "center": { "lat": 0, "lng": 0 },
    "zoom": 3
  }
}
```

You can change the saved center / zoom later by panning the map and using
**Save view** *(if exposed in your build)* or via direct API call (below).

## Steps (API — for scripts, tests, or non-default centers)

Useful when seeding test data, scripting fixtures, or creating a map
already centered on a specific point.

```bash
# Get a token (see flow-user-registration.md for the register flow)
TOKEN="..."         # JWT from /auth/login
TENANT_ID=...       # from the login response

curl -X POST "http://localhost:8080/api/v1/tenants/${TENANT_ID}/maps" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Catskills Hikes 2026",
    "description": "Tracking trail visits this season",
    "coordinateSystem": {
      "type": "wgs84",
      "center": { "lat": 42.0, "lng": -74.4 },
      "zoom": 10
    }
  }'
```

Response:

```json
{
  "id": 42,
  "ownerId": 7,
  "ownerUsername": "alice",
  "title": "Catskills Hikes 2026",
  "description": "Tracking trail visits this season",
  "coordinateSystem": { "type": "wgs84", "center": { "lat": 42.0, "lng": -74.4 }, "zoom": 10 },
  "ownerXray": false,
  "createdAt": "2026-04-29T...",
  "updatedAt": "2026-04-29T...",
  "permission": "owner"
}
```

Navigate to `/tenants/${TENANT_ID}/maps/${response.id}` in the browser to
view it.

## Coordinate-system fields reference

For a `wgs84` coordinate system the schema is:

| Field | Type | Notes |
|---|---|---|
| `type` | `"wgs84"` | Discriminator — must be exactly this string |
| `center.lat` | number | Latitude in degrees, `-90` to `90` |
| `center.lng` | number | Longitude in degrees, `-180` to `180` |
| `zoom` | number | Leaflet zoom level. `1` = whole earth, `18` = building-level |

The frontend's Leaflet layer renders standard OSM tiles
(`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`) at this center +
zoom on first load.
