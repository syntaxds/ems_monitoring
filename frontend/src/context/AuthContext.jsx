import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { login as apiLogin } from '../services/api';

const AuthContext = createContext(null);

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function readStoredUser() {
  const token = localStorage.getItem('ems_token');
  if (!token) return { token: null, user: null };
  const decoded = decodeJwt(token);
  // Treat an expired token as logged out.
  if (decoded && decoded.exp && decoded.exp * 1000 < Date.now()) {
    localStorage.removeItem('ems_token');
    localStorage.removeItem('ems_user');
    return { token: null, user: null };
  }
  const stored = localStorage.getItem('ems_user');
  const user = stored ? JSON.parse(stored) : decoded;
  return { token, user };
}

export function AuthProvider({ children }) {
  const initial = readStoredUser();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState(initial.user);

  const login = useCallback(async (username, password) => {
    const { data } = await apiLogin(username, password);
    const userObj = { user_id: data.user_id, username: data.username, role: data.role };
    localStorage.setItem('ems_token', data.token);
    localStorage.setItem('ems_user', JSON.stringify(userObj));
    setToken(data.token);
    setUser(userObj);
    return userObj;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ems_token');
    localStorage.removeItem('ems_user');
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, isAuthenticated: !!token }),
    [token, user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
