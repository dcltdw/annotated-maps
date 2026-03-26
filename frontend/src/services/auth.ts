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

  async refreshToken(): Promise<AuthResponse> {
    const res = await apiClient.post<AuthResponse>('/auth/refresh');
    return res.data;
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },
};
