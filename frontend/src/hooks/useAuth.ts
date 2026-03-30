import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import type { LoginRequest, RegisterRequest } from '@/types';

export function useAuth() {
  const { user, token, orgId, tenantId, tenants, isAuthenticated, setAuth, logout } =
    useAuthStore();

  async function login(data: LoginRequest) {
    const resp = await authService.login(data);
    setAuth(resp.user, resp.token, resp.orgId, resp.tenantId, resp.tenants);
    return resp;
  }

  async function register(data: RegisterRequest) {
    const resp = await authService.register(data);
    setAuth(resp.user, resp.token, resp.orgId, resp.tenantId, resp.tenants);
    return resp;
  }

  async function logoutUser() {
    try {
      await authService.logout();
    } finally {
      logout();
    }
  }

  return {
    user,
    token,
    orgId,
    tenantId,
    tenants,
    isAuthenticated,
    login,
    register,
    logout: logoutUser,
  };
}
