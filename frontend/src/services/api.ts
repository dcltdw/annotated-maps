import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/authStore';
import type { ApiError } from '@/types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT token to every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── 401 + token-refresh interceptor (#168) ─────────────────────────────────
//
// On 401 from any non-`/auth/*` endpoint, attempt a single token refresh and
// retry the original request transparently. If refresh fails (or itself 401s),
// log out + redirect — same fallback as before #168.
//
// Concurrent 401s share one in-flight refresh: the first 401 fires the
// refresh, subsequent 401s `await` the same promise, then all retry with the
// new token. Without this, N parallel failing requests fire N refreshes
// (and the second+ refresh would itself 401 if the backend rotates tokens).
//
// `_refreshRetried` on the request config guards against an infinite loop
// in the case where the retried original request also 401s — falls through
// to logout instead of recursing.

type RetryConfig = InternalAxiosRequestConfig & {
  _refreshRetried?: boolean;
};

let refreshInFlight: Promise<string | null> | null = null;

function performRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // Imported lazily to avoid circular dep with services/auth.ts
      const { authService } = await import('./auth');
      const { token } = await authService.refreshToken();
      useAuthStore.getState().setToken(token);
      return token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const config = error.config as RetryConfig | undefined;
    const url = config?.url ?? '';
    const isAuthEndpoint = url.includes('/auth/');
    const status = error.response?.status;

    // 401 on a non-auth endpoint, not already a retry → try refresh.
    if (status === 401 && !isAuthEndpoint && config && !config._refreshRetried) {
      const newToken = await performRefresh();
      if (newToken) {
        config._refreshRetried = true;
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(config);
      }
      // Refresh returned null (failed) → fall through to logout below.
    }

    // 401 on a non-auth endpoint after refresh-fail (or refresh-retry) → log out.
    // 401 on an /auth/* endpoint (login, register) propagates as-is — those
    // 401s are user-facing errors ("wrong password"), not session expiry.
    if (status === 401 && !isAuthEndpoint) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
