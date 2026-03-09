import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../services/api";

interface User {
  id: string;
  username: string;
  avatarUrl?: string;
  status: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("username");
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const fetchMe = async () => {
      if (token) {
        try {
          // api interceptor handles 401 -> refresh automatically
          const response = await api.get("/auth/me");
          setUser(response.data);
          localStorage.setItem("username", response.data.username);
          // Update token in state if it was refreshed by interceptor
          const currentToken = localStorage.getItem("token");
          if (currentToken && currentToken !== token) {
            setToken(currentToken);
          }
        } catch (error) {
          console.error("Failed to fetch user", error);
          // Only logout if refresh also failed (interceptor already tried)
          logout();
        }
      }
      setLoading(false);
    };

    fetchMe();
  }, []); // Run only once on mount, not on token change

  // Listen for forced logout from api interceptor
  useEffect(() => {
    const handleLogout = () => logout();
    window.addEventListener("auth:logout", handleLogout);
    return () => window.removeEventListener("auth:logout", handleLogout);
  }, [logout]);

  const login = useCallback((newToken: string, newUser: User, refreshToken?: string) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("username", newUser.username);
    if (refreshToken) {
      localStorage.setItem("refreshToken", refreshToken);
    }
    setToken(newToken);
    setUser(newUser);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
