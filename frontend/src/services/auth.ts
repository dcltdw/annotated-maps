import { apiClient } from './api';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/types';

export const authService = {
  async login(data: LoginRequest): Promise<AuthResponse> {
    const res = await apiClient.post<AuthResponse>('/auth/login', data);
    return res.data;
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const res = await apiClient.post<AuthResponse>('/auth/register', data);
    return res.data;
  },

  async refreshToken(): Promise<{ token: string }> {
    const res = await apiClient.post<{ token: string }>('/auth/refresh');
    return res.data;
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },

  // Redirect the browser to the IdP for the given org slug.
  // This is a full-page navigation, not an API call.
  ssoInitiate(orgSlug: string): void {
    const base = import.meta.env.VITE_API_URL ?? '/api/v1';
    window.location.href = `${base}/auth/sso/${encodeURIComponent(orgSlug)}`;
  },

  // M3: exchange a one-time SSO code (delivered via ?code= query param
  // after the IdP callback) for the application JWT and tenant ID. The
  // code lives server-side for ~2 minutes and is consumed on first use.
  async ssoExchange(code: string): Promise<{ token: string; tenantId: number }> {
    const res = await apiClient.post<{ token: string; tenantId: number }>(
      '/auth/sso/exchange', { code }
    );
    return res.data;
  },
};
