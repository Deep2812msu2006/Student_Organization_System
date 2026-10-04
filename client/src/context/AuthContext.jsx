import { createContext, useContext, useEffect, useState } from 'react';
import { api, setCsrf } from '../services/api.js';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('skyline_auth_token'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api('/auth/me');
      setUser(data.user);
      setCsrf(data.csrfToken);
      if (data.token) {
        localStorage.setItem('skyline_auth_token', data.token);
        setToken(data.token);
      }
    } catch (e) {
      setUser(null);
      if (e.status !== 401) setError(e.message);
      if (e.status === 401) {
        localStorage.removeItem('skyline_auth_token');
        setToken(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function authenticate(mode, values) {
    const { data } = await api(`/auth/${mode}`, { method: 'POST', body: values });
    setUser(data.user);
    setCsrf(data.csrfToken);
    if (data.token) {
      localStorage.setItem('skyline_auth_token', data.token);
      setToken(data.token);
    }
    setError('');
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (_e) {
      // ignore network errors on logout
    } finally {
      localStorage.removeItem('skyline_auth_token');
      setUser(null);
      setToken(null);
      setCsrf(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, error, refresh, authenticate, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
