import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from '@/components/Layout/Navbar';
import { LoginForm } from '@/components/Auth/LoginForm';
import { RegisterForm } from '@/components/Auth/RegisterForm';
import { SsoCallbackPage } from '@/pages/SsoCallbackPage';
import { useAuthStore } from '@/store/authStore';
import { useBranding } from '@/hooks/useBranding';
import { lazy, Suspense } from 'react';

const MapListPage   = lazy(() => import('@/pages/MapListPage').then((m)   => ({ default: m.MapListPage })));
const MapDetailPage = lazy(() => import('@/pages/MapDetailPage').then((m) => ({ default: m.MapDetailPage })));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function DefaultRedirect() {
  const { isAuthenticated, tenantId } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (tenantId) return <Navigate to={`/tenants/${tenantId}/maps`} replace />;
  return <Navigate to="/login" replace />;
}

function LoadingFallback() {
  return <div className="page-loading">Loading…</div>;
}

export default function App() {
  useBranding();

  return (
    <BrowserRouter>
      <div className="app-layout">
        <Navbar />
        <main className="app-main">
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* Public auth */}
              <Route path="/login"    element={<LoginForm />} />
              <Route path="/register" element={<RegisterForm />} />

              {/* SSO callback */}
              <Route path="/sso/callback" element={<SsoCallbackPage />} />

              {/* Tenant-scoped map list */}
              <Route
                path="/tenants/:tenantId/maps"
                element={
                  <PrivateRoute>
                    <MapListPage />
                  </PrivateRoute>
                }
              />

              {/* Tenant-scoped map detail */}
              <Route
                path="/tenants/:tenantId/maps/:mapId"
                element={<MapDetailPage />}
              />

              {/* Default */}
              <Route path="/" element={<DefaultRedirect />} />
              <Route path="*" element={<DefaultRedirect />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}
