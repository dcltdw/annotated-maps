import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const tenantId = useAuthStore((s) => s.tenantId);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/">📍 Annotated Maps</Link>
      </div>
      <div className="navbar-menu">
        {isAuthenticated ? (
          <>
            <Link to="/maps">My Maps</Link>
            {tenantId && (
              <Link to={`/tenants/${tenantId}/visibility-groups`}>
                Visibility
              </Link>
            )}
            <span className="navbar-user">{user?.username}</span>
            <button onClick={handleLogout} className="btn btn-ghost">
              Sign Out
            </button>
          </>
        ) : (
          <>
            <Link to="/login">Sign In</Link>
            <Link to="/register" className="btn btn-primary">
              Sign Up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
