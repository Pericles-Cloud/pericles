'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  User,
  Organization,
  storeTokens,
  clearTokens,
  getAccessToken,
  getCurrentUser,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getGoogleAuthUrl,
  setSessionExpiredCallback,
  clearSessionExpiredCallback,
} from '@/lib/api-client';

interface AuthState {
  user: User | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  loginWithGoogle: (redirect?: string) => void;
  refreshUser: () => Promise<void>;
  setCurrentOrganization: (org: Organization) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PUBLIC_PATHS = ['/login', '/register', '/auth/callback'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const initializedRef = useRef(false);

  const [state, setState] = useState<AuthState>({
    user: null,
    organizations: [],
    currentOrganization: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const refreshUser = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setState({
        user: null,
        organizations: [],
        currentOrganization: null,
        isLoading: false,
        isAuthenticated: false,
      });
      return;
    }

    try {
      const response = await getCurrentUser();

      if (response.success && response.data) {
        const { user, organizations } = response.data;
        setState({
          user,
          organizations,
          currentOrganization: organizations[0] || null,
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        clearTokens();
        setState({
          user: null,
          organizations: [],
          currentOrganization: null,
          isLoading: false,
          isAuthenticated: false,
        });
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      clearTokens();
      setState({
        user: null,
        organizations: [],
        currentOrganization: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, []);

  // Initialize auth state on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initAuth = async () => {
      const token = getAccessToken();
      if (!token) {
        setState({
          user: null,
          organizations: [],
          currentOrganization: null,
          isLoading: false,
          isAuthenticated: false,
        });
        return;
      }

      try {
        const response = await getCurrentUser();

        if (response.success && response.data) {
          const { user, organizations } = response.data;
          setState({
            user,
            organizations,
            currentOrganization: organizations[0] || null,
            isLoading: false,
            isAuthenticated: true,
          });
        } else {
          clearTokens();
          setState({
            user: null,
            organizations: [],
            currentOrganization: null,
            isLoading: false,
            isAuthenticated: false,
          });
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        clearTokens();
        setState({
          user: null,
          organizations: [],
          currentOrganization: null,
          isLoading: false,
          isAuthenticated: false,
        });
      }
    };

    initAuth();
  }, []);

  // Redirect logic
  useEffect(() => {
    if (state.isLoading) return;

    const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path));

    if (!state.isAuthenticated && !isPublicPath) {
      router.push('/login');
    } else if (state.isAuthenticated && (pathname === '/login' || pathname === '/register')) {
      router.push('/dashboard');
    }
  }, [state.isLoading, state.isAuthenticated, pathname, router]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiLogin(email, password);

    if (response.success && response.data) {
      storeTokens(response.data.accessToken, response.data.refreshToken);

      setState({
        user: response.data.user,
        organizations: response.data.organization ? [response.data.organization] : [],
        currentOrganization: response.data.organization,
        isLoading: false,
        isAuthenticated: true,
      });

      return { success: true };
    }

    return {
      success: false,
      error: response.error?.message || 'Login failed',
    };
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const response = await apiRegister(email, password, name);

    if (response.success && response.data) {
      storeTokens(response.data.accessToken, response.data.refreshToken);

      setState({
        user: response.data.user,
        organizations: response.data.organization ? [response.data.organization] : [],
        currentOrganization: response.data.organization,
        isLoading: false,
        isAuthenticated: true,
      });

      return { success: true };
    }

    return {
      success: false,
      error: response.error?.message || 'Registration failed',
    };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();

    // Clear all cached data
    clearTokens();
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
    }

    setState({
      user: null,
      organizations: [],
      currentOrganization: null,
      isLoading: false,
      isAuthenticated: false,
    });

    router.push('/login');
  }, [router]);

  // Handle session expiration (called from api-client when token refresh fails)
  const handleSessionExpired = useCallback(() => {
    // Clear all cached data
    clearTokens();
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
    }

    setState({
      user: null,
      organizations: [],
      currentOrganization: null,
      isLoading: false,
      isAuthenticated: false,
    });

    // Redirect to login with session expired message
    router.push('/login?error=session_expired');
  }, [router]);

  // Set up session expired callback on mount
  useEffect(() => {
    setSessionExpiredCallback(handleSessionExpired);
    return () => {
      clearSessionExpiredCallback();
    };
  }, [handleSessionExpired]);

  const loginWithGoogle = useCallback((redirect?: string) => {
    window.location.href = getGoogleAuthUrl(redirect);
  }, []);

  const setCurrentOrganization = useCallback((org: Organization) => {
    setState(prev => ({ ...prev, currentOrganization: org }));
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    loginWithGoogle,
    refreshUser,
    setCurrentOrganization,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
