---
id: F-001
title: Click-on-map location placement
type: functional
status: proposed
issue: 153
pr: null
depends_on: []
owner: dcltdw
last_updated: 2026-05-11
---

## Summary

Add a "place a location here" gesture on the map view so users can create a node by clicking the desired spot, instead of typing coordinates into the existing create-node modal. A toolbar button toggles "placement mode" on `MapView`; while in mode the cursor becomes a crosshair and the next map click captures the spot, opens the existing `CreateNodeModal` (from #150) with the coordinates pre-filled, and lets the user complete the create flow as normal. The same gesture works on all three coordinate systems (wgs84, pixel, blank) — the modal already adapts its coordinate fields per system. This ticket establishes the toolbar overlay + placement-mode state-machine pattern that future geometry gestures (line, polygon) will plug into.

## Inputs

- Click on the map-view "Add location here" toolbar button.
- Subsequent click on the Leaflet map surface (captured as `event.latlng` for wgs84, or pixel coords computed from `event.containerPoint` for non-wgs84 maps).
- Escape key, right-click on the map, or a second click on the toolbar button (all three cancel placement mode).
- The active map's `coordinateSystem.type` (determines whether captured coords go to lat/lng or x/y fields).

## Behaviour

1. The toolbar button "Add location here" is visible on `MapView` at all zoom levels and on all three coordinate-system renderers.
2. Clicking the toolbar button enters placement mode: the map cursor becomes a crosshair via a CSS class on the map container.
3. While in placement mode, the next single click on the map captures the click coordinates and opens `CreateNodeModal` with those coordinates pre-filled into the relevant fields.
4. After the modal opens, placement mode exits automatically — a second click on the map without re-entering mode does nothing special.
5. Pressing Escape, right-clicking the map, or clicking the toolbar button again while in placement mode exits the mode without opening the modal.
6. Submitting the modal creates the node at the captured coordinates and renders it on the map at that spot.
7. Cancelling the modal does not delete a partially-created node (nothing is created until submit).
8. Placement-mode state is local to `MapView` and does not affect other components; the cross-component command/bump pattern is not used here.

## Outputs

- Visible toolbar button on the map view.
- A `cursor: crosshair` class on the map container while in placement mode.
- The existing `CreateNodeModal` opened with pre-filled coordinate fields.
- On submit: a new row in `nodes` with the captured geometry; a re-rendered marker on the map.

## Edge cases

- **Click on a marker or polyline instead of empty map**: the click still opens the create modal at the marker's coordinates (no special "you clicked a marker" handling); follow-up issue if this proves confusing in practice.
- **Click outside the map viewport**: Leaflet doesn't fire a map click for clicks outside the container, so no action.
- **Zoom or pan during placement mode**: zoom/pan continue to work; placement mode stays active until cancel or click.
- **Network failure on modal submit**: the existing modal error handling applies (error banner inside the modal); placement mode has already exited, so no recovery is needed there.
- **Coordinate precision on pixel maps**: `event.containerPoint` returns float pixels; the captured coords are passed through to the modal without rounding.

## Out of scope

- **Line and polygon drawing** (click-click-click for polylines, double-click to finish). This ticket lays the toolbar + mode-state foundation that future geometry types will reuse.
- **Editing existing geometry** (drag a marker to a new location, reshape a polygon). Separate ticket.
- **Multi-point capture**: this ticket is single-click → single Point geometry.
- **Touch / mobile gestures**: out of scope for v1; the Leaflet click event fires on touch, but no touch-specific UX (long-press, two-finger gestures) is added.

## Verification

- `frontend/tests/e2e/<new-spec>.spec.ts`:
  - Open a fresh wgs84 map → click toolbar → click map → verify modal opens with lat/lng pre-filled → fill name → submit → verify the node is created at that spot.
  - Same flow on a blank map (validates pixel-coord routing on a non-wgs84 system).
  - Esc-cancel: enter placement mode → press Esc → confirm mode exited (clicking map does NOT open modal).
- Manual: pixel-map placement (if the pixel-map test plumbing is in good shape; otherwise smoke-test manually and note in the PR).
- No regression in existing E2E specs (`frontend/tests/e2e/coordinate-systems-crud.spec.ts`, `frontend/tests/e2e/edges-epic.spec.ts`).

## Open questions

_None._
