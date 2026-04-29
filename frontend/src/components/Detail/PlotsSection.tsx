import { useCallback, useEffect, useState, useMemo } from 'react';
import { plotsService } from '@/services/maps';
import { extractApiError } from '@/utils/errors';
import type { PlotRecord } from '@/api/schemas';

// Phase 2g.k (#139): per-item Plots section in the node/note detail
// panel. Lists the plots this node/note is in; quick-add picks from the
// tenant's full plot list minus what's already attached.
//
// Backed by two new endpoints from #139:
//   GET /tenants/{tid}/maps/{mid}/nodes/{nid}/plots
//   GET /tenants/{tid}/maps/{mid}/notes/{nid}/plots
// Both return 404 if the caller can't see the underlying entity — the
// component renders that state as a benign empty + error message rather
// than swallowing it, since the parent panel only shows this section
// when an item *is* selected and visible.
//
// The quick-add dropdown reuses the existing plot CRUD mutations from
// plotsService (addNode / removeNode / addNote / removeNote). When the
// list of available plots is empty (all attached, or the tenant has no
// plots yet), the form collapses into a small disabled hint.

interface PlotsSectionProps {
  mapId: number;
  kind: 'node' | 'note';
  entityId: number;
}

export function PlotsSection({ mapId, kind, entityId }: PlotsSectionProps) {
  const [attached, setAttached] = useState<PlotRecord[]>([]);
  const [allPlots, setAllPlots] = useState<PlotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlotId, setSelectedPlotId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two requests in parallel: this entity's plots + the tenant's
      // full plot list (powers the "available to attach" picker).
      const [mine, all] = await Promise.all([
        kind === 'node'
          ? plotsService.listPlotsForNode(mapId, entityId)
          : plotsService.listPlotsForNote(mapId, entityId),
        plotsService.listPlots(),
      ]);
      setAttached(mine);
      setAllPlots(all);
    } catch (e) {
      setError(extractApiError(e, 'Failed to load plots.'));
      setAttached([]);
      setAllPlots([]);
    } finally {
      setLoading(false);
    }
  }, [mapId, kind, entityId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const attachedIds = useMemo(
    () => new Set(attached.map((p) => p.id)),
    [attached],
  );
  const eligible = useMemo(
    () => allPlots.filter((p) => !attachedIds.has(p.id)),
    [allPlots, attachedIds],
  );

  const handleAttach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlotId) return;
    const plotId = Number(selectedPlotId);
    setBusy(true);
    setError(null);
    try {
      if (kind === 'node') {
        await plotsService.addNode(plotId, entityId);
      } else {
        await plotsService.addNote(plotId, entityId);
      }
      setSelectedPlotId('');
      await loadAll();
    } catch (err) {
      setError(extractApiError(err, 'Failed to attach to plot.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDetach = async (plotId: number) => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'node') {
        await plotsService.removeNode(plotId, entityId);
      } else {
        await plotsService.removeNote(plotId, entityId);
      }
      await loadAll();
    } catch (err) {
      setError(extractApiError(err, 'Failed to detach from plot.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="plots-section">
        <h3>Plots</h3>
        <p className="plots-section-empty">Loading…</p>
      </div>
    );
  }

  return (
    <div className="plots-section">
      <h3>Plots</h3>
      {error && <div className="alert alert-error">{error}</div>}

      {attached.length === 0 ? (
        <p className="plots-section-empty">Not in any plot.</p>
      ) : (
        <ul className="plots-section-list">
          {attached.map((p) => (
            <li key={p.id} className="plots-section-row">
              <span className="plots-section-name">{p.name}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleDetach(p.id)}
                disabled={busy}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {eligible.length > 0 ? (
        <form className="plots-section-add" onSubmit={handleAttach}>
          <select
            value={selectedPlotId}
            onChange={(e) => setSelectedPlotId(e.target.value)}
            disabled={busy}
          >
            <option value="">Add to plot…</option>
            {eligible.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy || !selectedPlotId}
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      ) : allPlots.length === 0 ? (
        <p className="plots-section-hint">
          No plots in this tenant yet — create one on the Plots page.
        </p>
      ) : (
        <p className="plots-section-hint">Already in every plot.</p>
      )}
    </div>
  );
}
