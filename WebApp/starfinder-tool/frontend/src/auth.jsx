import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading

  const refresh = () => api("/auth/me").then((r) => setUser(r.user));
  useEffect(() => { refresh(); }, []);

  const login = async (username, password) => {
    const u = await api("/auth/login", { method: "POST", body: { username, password } });
    setUser(u);
    return u;
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, refresh, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Wrap a route element: redirects to /login if not authenticated, or if
// `role` is given and doesn't match. `role="any"` just requires *some* login.
export function RequireAuth({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) return null; // still checking session
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (role && role !== "any" && user.role !== role) return <Navigate to="/" replace />;
  return children;
}
