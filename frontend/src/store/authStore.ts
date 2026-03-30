import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuthState, TenantSummary, TenantBranding } from '@/types';

interface AuthActions {
  setAuth: (
    user: User,
    token: string,
    orgId: number,
    tenantId: number,
    tenants: TenantSummary[]
  ) => void;
  setActiveTenant: (tenantId: number) => void;
  setBranding: (branding: TenantBranding) => void;
  logout: () => void;
}

const initialState: AuthState = {
  user: null,
  token: null,
  orgId: null,
  tenantId: null,
  tenants: [],
  branding: {},
  isAuthenticated: false,
};

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      ...initialState,

      setAuth: (user, token, orgId, tenantId, tenants) =>
        set({ user, token, orgId, tenantId, tenants, isAuthenticated: true }),

      setActiveTenant: (tenantId) =>
        set({ tenantId, branding: {} }),

      setBranding: (branding) =>
        set({ branding }),

      logout: () =>
        set({ ...initialState }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        orgId: state.orgId,
        tenantId: state.tenantId,
        tenants: state.tenants,
        branding: state.branding,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.token && state?.user) {
          state.isAuthenticated = true;
        }
      },
    }
  )
);
