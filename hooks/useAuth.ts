import { useEffect, useState } from 'react';
import { isAuthenticated, redirectIfNotAuthenticated } from 'services/authUtils';

interface UseAuthReturn {
  isAuthenticated: boolean | null;
  isLoading: boolean;
  checkAuth: () => Promise<void>;
  requireAuth: (showAlert?: boolean) => Promise<boolean>;
}

/**
 * Hook for managing authentication state
 */
export const useAuth = (): UseAuthReturn => {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      setLoading(true);
      const authStatus = await isAuthenticated();
      setAuthenticated(authStatus);
    } catch (error) {
      console.error('[useAuth] Error checking authentication:', error);
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const requireAuth = async (showAlert: boolean = true): Promise<boolean> => {
    const authStatus = await redirectIfNotAuthenticated(showAlert);
    setAuthenticated(authStatus);
    return authStatus;
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return {
    isAuthenticated: authenticated,
    isLoading: loading,
    checkAuth,
    requireAuth,
  };
};

/**
 * Hook that automatically redirects to login if not authenticated
 * Useful for protected screens
 */
export const useRequireAuth = (showAlert: boolean = false) => {
  const { isAuthenticated, isLoading, requireAuth } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated === false) {
      requireAuth(showAlert);
    }
  }, [isLoading, isAuthenticated, showAlert, requireAuth]);

  return {
    isAuthenticated,
    isLoading,
  };
};
