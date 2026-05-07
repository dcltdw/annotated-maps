import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { tenantsService } from '@/services/maps';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/utils/errors';
import type { TenantBranding } from '@/types';

// Tenant-admin page (#163, #162 to follow). Currently hosts the branding
// editor; member management will be added as a sibling section in #162.
//
// Auth-gated: tenant admin only. Backend's PUT /branding rejects with 403
// for non-admins; the UI shows a not-authorized banner if the role isn't
// admin so users don't waste a form submission.

export function TenantAdminPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const tenantIdNum = Number(tenantId);

  const role = useAuthStore((s) =>
    s.tenants.find((t) => t.id === tenantIdNum)?.role,
  );
  const isAdmin = role === 'admin';

  if (!tenantIdNum) {
    return <div className="page-error">Missing tenant in route.</div>;
  }
  if (!isAdmin) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Tenant administration</h1>
          <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
            ← Back to maps
          </Link>
        </div>
        <div className="alert alert-error">
          Only tenant admins can access this page.
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Tenant administration</h1>
        <Link to={`/tenants/${tenantId}/maps`} className="btn btn-ghost">
          ← Back to maps
        </Link>
      </div>
      <BrandingSection tenantId={tenantIdNum} />
    </div>
  );
}

// ─── Branding section ────────────────────────────────────────────────────────

function BrandingSection({ tenantId }: { tenantId: number }) {
  const setStoreBranding = useAuthStore((s) => s.setBranding);
  const [branding, setBranding] = useState<TenantBranding>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    tenantsService
      .getBranding(tenantId)
      .then((b) => { if (!cancelled) setBranding(b); })
      .catch((e) => { if (!cancelled) setError(extractApiError(e, 'Failed to load branding.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const update = (patch: Partial<TenantBranding>) => {
    setBranding((b) => ({ ...b, ...patch }));
    setSaved(false);
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const fresh = await tenantsService.updateBranding(tenantId, branding);
      setBranding(fresh);
      // Push to authStore so useBranding's render-side effect picks up
      // the new CSS custom properties without a page reload.
      setStoreBranding(fresh);
      setSaved(true);
    } catch (e) {
      setError(extractApiError(e, 'Failed to save branding.'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset branding to defaults? This clears all customizations.')) return;
    setError(null);
    setSaving(true);
    try {
      const fresh = await tenantsService.updateBranding(tenantId, {});
      setBranding(fresh);
      setStoreBranding(fresh);
      setSaved(true);
    } catch (e) {
      setError(extractApiError(e, 'Failed to reset branding.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="page-loading">Loading branding…</p>;

  return (
    <section className="tenant-admin-section">
      <h2>Branding</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-info">Saved.</div>}

      <div className="tenant-admin-form">
        <div className="form-group">
          <label htmlFor="brand-display-name">Display name</label>
          <input
            id="brand-display-name"
            value={branding.display_name ?? ''}
            onChange={(e) => update({ display_name: e.target.value || undefined })}
            placeholder="Annotated Maps"
            maxLength={255}
          />
        </div>

        <div className="form-group">
          <label htmlFor="brand-primary">Primary color</label>
          <div className="branding-color-row">
            <input
              id="brand-primary"
              type="color"
              value={branding.primary_color ?? '#2563eb'}
              onChange={(e) => update({ primary_color: e.target.value })}
            />
            <span className="branding-color-hex">{branding.primary_color ?? '(default)'}</span>
            {branding.primary_color && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => update({ primary_color: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="brand-accent">Accent color</label>
          <div className="branding-color-row">
            <input
              id="brand-accent"
              type="color"
              value={branding.accent_color ?? '#1d4ed8'}
              onChange={(e) => update({ accent_color: e.target.value })}
            />
            <span className="branding-color-hex">{branding.accent_color ?? '(default)'}</span>
            {branding.accent_color && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => update({ accent_color: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="brand-logo">Logo URL</label>
          <input
            id="brand-logo"
            value={branding.logo_url ?? ''}
            onChange={(e) => update({ logo_url: e.target.value || undefined })}
            placeholder="https://example.com/logo.png"
          />
        </div>

        {/* Preview swatch — applies the colors locally for preview without
            committing. The committed branding gets pushed into authStore
            on Save, which triggers useBranding's CSS-property writes. */}
        <div className="branding-preview">
          <span className="branding-preview-label">Preview</span>
          <span
            className="branding-preview-swatch"
            style={{
              background: branding.primary_color ?? '#2563eb',
              color: '#fff',
            }}
          >
            Primary
          </span>
          <span
            className="branding-preview-swatch"
            style={{
              background: branding.accent_color ?? '#1d4ed8',
              color: '#fff',
            }}
          >
            Accent
          </span>
          {branding.display_name && (
            <span className="branding-preview-label">{branding.display_name}</span>
          )}
        </div>

        <div className="tenant-admin-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleReset}
            disabled={saving}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </section>
  );
}
