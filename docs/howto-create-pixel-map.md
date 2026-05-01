# How to: Create a Pixel Map

A **pixel map** uses a static image as the backdrop instead of geographic
tiles. Coordinates are pixel `(x, y)` offsets within the image. Use this
for game-world maps, building floor plans, fictional worlds, historical
maps, or anything where the underlying graphic *is* the coordinate space.

If you're annotating real geography (real-world lat/lng), see
[howto-create-wgs84-map.md](howto-create-wgs84-map.md) instead. If you
want a blank canvas with no backdrop image at all, see
[howto-create-blank-map.md](howto-create-blank-map.md).

## Current limitation: API-only

> The "+ New Map" UI currently only creates WGS84 maps. Pixel-map
> creation is exposed via the backend API but doesn't yet have a UI
> picker. The frontend rendering side fully supports pixel maps once the
> map exists (see #128). A follow-up ticket will add the picker; until
> then, create pixel maps via `curl` (or the equivalent in your scripting
> tool) as shown below.

## Prerequisites

- A registered account on the running app
- A logged-in JWT token (capture from `/auth/login` response)
- An accessible image URL — must be `http://` or `https://`
- The image's dimensions in pixels (width × height) — needed for the
  bounds and viewport defaults

## Steps (API)

```bash
# Get token + tenantId from /auth/login (see flow-user-registration.md)
TOKEN="..."
TENANT_ID=...

# Image facts — fill these in
IMAGE_URL="https://example.com/my-dungeon-map.png"
WIDTH=2048      # image width in pixels
HEIGHT=1536     # image height in pixels

curl -X POST "http://localhost:8080/api/v1/tenants/${TENANT_ID}/maps" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"The Lost Dungeon\",
    \"description\": \"Level 3 of the megadungeon campaign\",
    \"coordinateSystem\": {
      \"type\": \"pixel\",
      \"image_url\": \"${IMAGE_URL}\",
      \"width\": ${WIDTH},
      \"height\": ${HEIGHT},
      \"viewport\": {
        \"x\": $((WIDTH / 2)),
        \"y\": $((HEIGHT / 2)),
        \"zoom\": 0
      }
    }
  }"
```

Response includes the map id; navigate to
`/tenants/${TENANT_ID}/maps/${id}` to view. The frontend overlays the
image and lets you place nodes by clicking on it. Node coordinates are
stored as `(x, y)` pixel offsets within the image.

## Coordinate-system fields reference

For a `pixel` coordinate system the schema is:

| Field | Type | Notes |
|---|---|---|
| `type` | `"pixel"` | Discriminator — must be exactly this string |
| `image_url` | string (URL) | Must be `http://` or `https://`. Loaded directly by the browser as an `<ImageOverlay>`. |
| `width` | int > 0 | Image width in pixels. The map's bounds run `x = 0..width`. |
| `height` | int > 0 | Image height in pixels. The map's bounds run `y = 0..height`. |
| `viewport.x` | number | Initial horizontal pan position (pixel x). Centered = `width / 2`. |
| `viewport.y` | number | Initial vertical pan position (pixel y). Centered = `height / 2`. |
| `viewport.zoom` | number | Leaflet zoom level on initial render. `0` shows the image at native resolution; negative zooms out (e.g. `-2` to see the whole image at once). |

## Coordinate convention

Pixel maps use Leaflet's `CRS.Simple` with the image overlay spanning
`[[0, 0], [height, width]]` — i.e. the top-left of the image is the
origin `(0, 0)` and y increases *downward* (image-pixel convention, not
math convention). Node `geoJson.coordinates` for a Point on a pixel map
is `[x, y]` measured in image pixels.

## Verifying the map renders

After creation:

1. Navigate to `/tenants/${TENANT_ID}/maps/${id}` in the browser
2. The image should appear as the map backdrop
3. Add a node via the API or (once #128's UI is wired) by clicking on the
   image
4. Confirm the node renders at the expected pixel position

If the image fails to load, check that `image_url` is reachable from the
browser (CORS, auth, etc.) — the backend doesn't proxy the image.
