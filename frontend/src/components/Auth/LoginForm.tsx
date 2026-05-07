import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/services/auth';
import { extractApiError } from '@/utils/errors';

export function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showSso, setShowSso] = useState(false);
  const [orgSlug, setOrgSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSsoSubmit = (e: FormEvent) => {
    e.preventDefault();
    const slug = orgSlug.trim();
    if (!slug) return;
    // Full-page navigation; the IdP redirects back to /sso/callback which
    // SsoCallbackPage exchanges for a JWT.
    authService.ssoInitiate(slug);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const ok = await login({ email, password });
      if (ok) navigate('/maps');
    } catch (err) {
      setError(extractApiError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Sign In</h1>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="auth-sso-divider"><span>or</span></div>

        {!showSso ? (
          <button
            type="button"
            className="btn btn-ghost btn-full"
            onClick={() => setShowSso(true)}
          >
            Use SSO
          </button>
        ) : (
          <form onSubmit={handleSsoSubmit} className="auth-form auth-sso-form">
            <div className="form-group">
              <label htmlFor="org-slug">Organization slug</label>
              <input
                id="org-slug"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                required
                placeholder="acme-corp"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={!orgSlug.trim()}
            >
              Continue to SSO
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-full"
              onClick={() => { setShowSso(false); setOrgSlug(''); }}
            >
              Cancel
            </button>
          </form>
        )}

        <p className="auth-footer">
          Don't have an account? <Link to="/register">Sign Up</Link>
        </p>
      </div>
    </div>
  );
}
