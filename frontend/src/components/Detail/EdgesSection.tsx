import { useCallback, useEffect, useMemo, useState } from 'react';
import { edgesService, nodesService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { EdgeRecord, NodeRecord } from '@/types';

// Per-node edges section in the detail panel (#200). Lists every edge
// touching the selected node, with a quick-remove per row and a
// "+ Edge from here" affordance that starts MapView's edge-create flow
// with the current node prefilled as source.
//
// The "other endpoint" — the node at the far end of each edge — is
// fetched in parallel so we can render its name. If a node lookup
// fails (e.g., visibility), the row falls back to a generic "Hidden
// location" label rather than disappearing, since the edge itself is
// still visible to the caller (#197 visibility derives from BOTH
// endpoints — if either is hidden, the edge wouldn't be in the list
// at all).

interface EdgesSectionProps {
  mapId: number;
  nodeId: number;
  /** Click on a row's "other endpoint" name selects that node. */
  onSelectNode: (nodeId: number) => void;
  /** Click on "+ Edge from here" — MapDetailPage relays to MapView so
   *  the toolbar state machine jumps into pickingDest with this node
   *  as source. */
  onStartEdgeFromNode: (sourceNodeId: number) => void;
  /** Fired after a successful mutation (currently: delete). Parent uses
   *  this to refresh sibling components — the map's edge layer in
   *  particular, which would otherwise be stale. */
  onChanged?: () => void;
}

interface RowInfo {
  edge: EdgeRecord;
  other: NodeRecord | null;
  outgoing: boolean;  // edge.sourceNodeId === nodeId
}

export function EdgesSection({
  mapId,
  nodeId,
  onSelectNode,
  onStartEdgeFromNode,
  onChanged,
}: EdgesSectionProps) {
  const [rows, setRows] = useState<RowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const edges = await edgesService.listEdgesForNode(mapId, nodeId);
      // Fetch the "other endpoint" for each row in parallel. Failures
      // resolve to null and the row renders with a fallback label.
      const otherIds = edges.map((e) =>
        e.sourceNodeId === nodeId ? e.destNodeId : e.sourceNodeId,
      );
      const fetched = await Promise.all(
        otherIds.map((oid) => nodesService.getNode(mapId, oid).catch(() => null)),
      );
      setRows(edges.map((e, i) => ({
        edge: e,
        other: fetched[i],
        outgoing: e.sourceNodeId === nodeId,
      })));
    } catch (e) {
      setError(extractApiError(e, 'Failed to load edges.'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [mapId, nodeId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleRemove = async (edgeId: number) => {
    if (!window.confirm('Remove this edge?')) return;
    setBusy(true);
    setError(null);
    try {
      await edgesService.deleteEdge(mapId, edgeId);
      onChanged?.();  // refresh sibling map render
      await loadAll();
    } catch (e) {
      setError(extractApiError(e, 'Failed to remove edge.'));
    } finally {
      setBusy(false);
    }
  };

  // Display the directed indicator from the perspective of THIS node:
  //   outgoing + directed → → (this node is the source)
  //   incoming + directed → ← (this node is the dest)
  //   not directed        → ↔
  const indicator = useMemo(() => (row: RowInfo) => {
    if (!row.edge.directed) return '↔';
    return row.outgoing ? '→' : '←';
  }, []);

  if (loading) {
    return (
      <div className="edges-section">
        <h3>Edges</h3>
        <p className="edges-section-empty">Loading…</p>
      </div>
    );
  }

  return (
    <div className="edges-section">
      <div className="edges-section-header">
        <h3>Edges</h3>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onStartEdgeFromNode(nodeId)}
        >
          + Edge from here
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {rows.length === 0 ? (
        <p className="edges-section-empty">No edges touching this location.</p>
      ) : (
        <ul className="edges-section-list">
          {rows.map((row) => (
            <li key={row.edge.id} className="edges-section-row">
              {row.edge.color && (
                <span
                  className="edges-section-color"
                  style={{ background: row.edge.color }}
                  aria-hidden="true"
                />
              )}
              <span className="edges-section-direction" aria-hidden="true">
                {indicator(row)}
              </span>
              {row.other ? (
                <button
                  type="button"
                  className="link-button edges-section-name"
                  onClick={() => onSelectNode(row.other!.id)}
                >
                  {row.other.name}
                </button>
              ) : (
                <span className="edges-section-name edges-section-name-hidden">
                  Hidden location
                </span>
              )}
              {row.edge.label && (
                <span className="edges-section-label">{row.edge.label}</span>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleRemove(row.edge.id)}
                disabled={busy}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
