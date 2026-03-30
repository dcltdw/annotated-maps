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
};
