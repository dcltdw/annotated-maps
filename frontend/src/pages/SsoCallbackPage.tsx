import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { tenantsService } from '@/services/maps';

/**
 * SsoCallbackPage
 *
 * The backend redirects here after a successful OIDC exchange:
 *   /sso/callback#token=<jwt>&tenantId=<id>
 *
 * 1. Reads token and tenantId from the URL fragment.
 * 2. Fetches the user's full tenant list from the API.
 * 3. Stores auth state and redirects to the tenant's map list.
 */
export function SsoCallbackPage() {
  const navigate = useNavigate();
  const setAuth  = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    const params   = new URLSearchParams(fragment);
    const token    = params.get('token');
    const tenantId = parseInt(params.get('tenantId') ?? '0', 10);

    if (!token) {
      navigate('/login?error=sso_failed', { replace: true });
      return;
    }

    try {
      const payload = JSON.parse(
        atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      );
      const userId   = parseInt(payload.sub, 10);
      const username = payload.username ?? '';
      const orgId    = parseInt(payload.orgId ?? '0', 10);

      // Temporarily populate store so apiClient can attach the token
      useAuthStore.setState({
        token,
        user: { id: userId, username, email: '' },
        orgId,
        tenantId,
        tenants: [],
        isAuthenticated: true,
      });

      tenantsService.listTenants().then((tenants) => {
        const activeTenantId = tenantId || tenants[0]?.id || 0;
        setAuth(
          { id: userId, username, email: '' },
          token,
          orgId,
          activeTenantId,
          tenants.map((t) => ({ id: t.id, name: t.name, slug: t.slug, role: t.role }))
        );
        if (activeTenantId) {
          navigate(`/tenants/${activeTenantId}/maps`, { replace: true });
        } else {
          navigate('/login?error=no_tenant', { replace: true });
        }
      }).catch(() => {
        navigate('/login?error=sso_failed', { replace: true });
      });
    } catch {
      navigate('/login?error=sso_failed', { replace: true });
    }
  }, [navigate, setAuth]);

  return <div className="page-loading">Completing sign-in…</div>;
}
