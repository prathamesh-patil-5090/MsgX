import { router } from 'expo-router';
import { Alert } from 'react-native';
import { clearTokens } from './loginApi';

/**
 * Handle authentication errors consistently across the app
 * @param error - The error that occurred
 * @param showAlert - Whether to show an alert to the user
 * @returns true if the error was an authentication error, false otherwise
 */
export const handleAuthError = async (
  error: unknown,
  showAlert: boolean = true
): Promise<boolean> => {
  const errorMessage = error instanceof Error ? error.message : String(error);

  const isAuthError =
    errorMessage.includes('Authentication expired') ||
    errorMessage.includes('Authentication required') ||
    errorMessage.includes('Invalid token') ||
    errorMessage.includes('Token expired');

  if (isAuthError) {
    console.log('[AuthUtils] Authentication error detected, redirecting to login');

    try {
      await clearTokens();
    } catch (clearError) {
      console.error('[AuthUtils] Error clearing tokens:', clearError);
    }

    if (showAlert) {
      Alert.alert(
        'Session Expired',
        'Your session has expired. Please login again.',
        [
          {
            text: 'OK',
            onPress: () => {
              router.replace('/login');
            },
          },
        ],
        { cancelable: false }
      );
    } else {
      router.replace('/login');
    }

    return true;
  }

  return false;
};

/**
 * Wrapper function to execute API calls with automatic auth error handling
 * @param apiCall - The API function to execute
 * @param showAlert - Whether to show alert on auth error
 * @returns The result of the API call or throws non-auth errors
 */
export const withAuthErrorHandling = async <T>(
  apiCall: () => Promise<T>,
  showAlert: boolean = true
): Promise<T | null> => {
  try {
    return await apiCall();
  } catch (error) {
    console.error('[AuthUtils] API call failed:', error);

    const wasAuthError = await handleAuthError(error, showAlert);

    if (wasAuthError) {
      return null;
    }

    throw error;
  }
};

/**
 * Check if the user is authenticated (has valid tokens)
 * @returns true if user appears to be authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const { getAccessToken, getRefreshToken } = await import('./loginApi');
    const accessToken = await getAccessToken();
    const refreshToken = await getRefreshToken();

    return !!(accessToken && refreshToken);
  } catch (error) {
    console.error('[AuthUtils] Error checking authentication status:', error);
    return false;
  }
};

/**
 * Redirect to login if not authenticated
 * @param showAlert - Whether to show an alert before redirecting
 */
export const redirectIfNotAuthenticated = async (showAlert: boolean = false): Promise<boolean> => {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    console.log('[AuthUtils] User not authenticated, redirecting to login');

    if (showAlert) {
      Alert.alert(
        'Authentication Required',
        'Please login to continue.',
        [
          {
            text: 'OK',
            onPress: () => {
              router.replace('/login');
            },
          },
        ],
        { cancelable: false }
      );
    } else {
      router.replace('/login');
    }

    return false;
  }

  return true;
};
