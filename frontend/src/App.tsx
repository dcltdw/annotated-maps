import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from '@/components/Layout/Navbar';
import { LoginForm } from '@/components/Auth/LoginForm';
import { RegisterForm } from '@/components/Auth/RegisterForm';
import { useAuthStore } from '@/store/authStore';

// Lazy-loaded pages (code-split for PWA performance)
import { lazy, Suspense } from 'react';
const MapListPage = lazy(() => import('@/pages/MapListPage').then((m) => ({ default: m.MapListPage })));
const MapDetailPage = lazy(() => import('@/pages/MapDetailPage').then((m) => ({ default: m.MapDetailPage })));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function LoadingFallback() {
  return <div className="page-loading">Loading…</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Navbar />
        <main className="app-main">
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginForm />} />
              <Route path="/register" element={<RegisterForm />} />
              {/* Public map view (read-only if not logged in / no permission) */}
              <Route path="/maps/:mapId" element={<MapDetailPage />} />

              {/* Authenticated */}
              <Route
                path="/maps"
                element={
                  <PrivateRoute>
                    <MapListPage />
                  </PrivateRoute>
                }
              />

              {/* Default */}
              <Route path="/" element={<Navigate to="/maps" replace />} />
              <Route path="*" element={<Navigate to="/maps" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}
