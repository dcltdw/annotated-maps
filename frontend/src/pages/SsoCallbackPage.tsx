import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { tenantsService } from '@/services/maps';

/**
 * SsoCallbackPage
 *
 * The backend redirects here after a successful OIDC exchange:
 *   /sso/callback?code=<one-time-code>
 *
 * (Previously the JWT was passed in the URL fragment; that route leaked
 *  via browser history, Referer headers, and extensions. See #58 / M3.)
 *
 * 1. Reads the one-time code from the query string.
 * 2. POSTs it to /api/v1/auth/sso/exchange to retrieve the JWT + tenantId.
 * 3. Fetches the user's full tenant list, populates the auth store, and
 *    redirects to the tenant's map list.
 */
export function SsoCallbackPage() {
  const navigate = useNavigate();
  const setAuth  = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');

    if (!code) {
      navigate('/login?error=sso_failed', { replace: true });
      return;
    }

    authService.ssoExchange(code)
      .then(({ token, tenantId }) => {
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

        return tenantsService.listTenants().then((tenants) => {
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
        });
      })
      .catch(() => {
        navigate('/login?error=sso_failed', { replace: true });
      });
  }, [navigate, setAuth]);

  return <div className="page-loading">Completing sign-in…</div>;
}
