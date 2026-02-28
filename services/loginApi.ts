import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_ID_KEY = 'user_id';

export const storeTokens = async (accessToken: string, refreshToken: string) => {
  try {
    if (!accessToken || !refreshToken) {
      console.warn('Attempted to store invalid tokens');
      return;
    }
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch (error) {
    console.error('Error storing tokens:', error);
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  try {
    const token = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
    return token === 'null' || token === 'undefined' ? null : token;
  } catch (error) {
    console.error('Error getting access token:', error);
    return null;
  }
};

export const getRefreshToken = async (): Promise<string | null> => {
  try {
    const token = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    return token === 'null' || token === 'undefined' ? null : token;
  } catch (error) {
    console.error('Error getting refresh token:', error);
    return null;
  }
};

export const clearTokens = async () => {
  try {
    await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    await AsyncStorage.removeItem(USER_ID_KEY);
  } catch (error) {
    console.error('Error clearing tokens:', error);
    throw error;
  }
};

export const storeUserId = async (userId: string) => {
  try {
    if (!userId || userId === 'undefined' || userId === 'null') {
      console.warn('Attempted to store invalid user ID:', userId);
      return;
    }
    await AsyncStorage.setItem(USER_ID_KEY, userId);
  } catch (error) {
    console.error('Error storing user ID:', error);
    throw error;
  }
};

export const getUserId = async (): Promise<string | null> => {
  try {
    const userId = await AsyncStorage.getItem(USER_ID_KEY);
    return userId === 'null' || userId === 'undefined' ? null : userId;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
};

const parseSetCookieHeader = (
  setCookieHeaders: string[]
): { accessToken?: string; refreshToken?: string } => {
  const tokens: { accessToken?: string; refreshToken?: string } = {};

  setCookieHeaders.forEach((cookie) => {
    if (cookie.includes('access_token=')) {
      const match = cookie.match(/access_token=([^;]+)/);
      if (match) tokens.accessToken = match[1];
    }
    if (cookie.includes('refresh_token=')) {
      const match = cookie.match(/refresh_token=([^;]+)/);
      if (match) tokens.refreshToken = match[1];
    }
  });

  return tokens;
};

export interface LoginRequest {
  username_or_email: string;
  password: string;
}

export interface LoginResponse {
  message: string;
}

export interface RegisterResponse {
  message: string;
  user: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    username: string;
  };
}

export interface RegisterRequest {
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  password: string;
}

export const registerApi = async (credentials: RegisterRequest): Promise<RegisterResponse> => {
  try {
    if (!API_BASE_URL) {
      throw new Error('API_BASE_URL is not configured. Please check your .env file.');
    }
    const response = await fetch(`${API_BASE_URL}/auth/register/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    const setCookieHeaders = response.headers.get('set-cookie');

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Backend error response:', errorData);
      console.error('Error details:', JSON.stringify(errorData, null, 2));
      throw new Error(
        errorData.message ||
          errorData.error ||
          JSON.stringify(errorData) ||
          `Register failed with status ${response.status}`
      );
    }

    const data: RegisterResponse = await response.json();
    console.log('Register successful:', data);

    if (setCookieHeaders) {
      const cookies = setCookieHeaders.split(',');
      const { accessToken, refreshToken } = parseSetCookieHeader(cookies);

      if (accessToken && refreshToken) {
        await storeTokens(accessToken, refreshToken);
        await storeUserId(data.user.id.toString());
        console.log('Tokens and user ID stored successfully');
      } else {
        console.warn('No tokens found in response cookies');
      }
    } else {
      console.warn('No Set-Cookie headers in response');
    }

    return data;
  } catch (error) {
    console.error('Register API error:', error);
    if (error instanceof Error) {
      if (error.message === 'Network request failed') {
        throw new Error(
          'Cannot connect to server. Please ensure:\n' +
            '1. Your backend is running on port 8000\n' +
            '2. Using Android emulator with 10.0.2.2\n' +
            '3. Or use your computer IP (e.g., 192.168.1.x) for physical devices'
        );
      }
    }
    throw error;
  }
};

export const loginApi = async (credentials: LoginRequest): Promise<LoginResponse> => {
  try {
    console.log('Attempting login to:', `${API_BASE_URL}/auth/login/`);
    console.log('API_BASE_URL:', API_BASE_URL);

    if (!API_BASE_URL) {
      throw new Error('API_BASE_URL is not configured. Please check your .env file.');
    }

    const response = await fetch(`${API_BASE_URL}/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    console.log('Response status:', response.status);
    const setCookieHeaders = response.headers.get('set-cookie');

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Backend error response:', errorData);
      console.error('Error details:', JSON.stringify(errorData, null, 2));
      throw new Error(
        errorData.message ||
          errorData.error ||
          JSON.stringify(errorData) ||
          `Login failed with status ${response.status}`
      );
    }

    const data: LoginResponse = await response.json();
    console.log('Login successful:', data);

    if (setCookieHeaders) {
      const cookies = setCookieHeaders.split(',');
      const { accessToken, refreshToken } = parseSetCookieHeader(cookies);

      if (accessToken && refreshToken) {
        await storeTokens(accessToken, refreshToken);

        try {
          const base64Url = accessToken.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          );
          const payload = JSON.parse(jsonPayload);
          if (payload.user_id) {
            await storeUserId(payload.user_id.toString());
            console.log('Tokens and user ID stored successfully');
          }
        } catch (tokenError) {
          console.warn('Could not extract user ID from token:', tokenError);
        }
      } else {
        console.warn('No tokens found in response cookies');
      }
    } else {
      console.warn('No Set-Cookie headers in response');
    }

    return data;
  } catch (error) {
    console.error('Login API error:', error);
    if (error instanceof Error) {
      if (error.message === 'Network request failed') {
        throw new Error(
          'Cannot connect to server. Please ensure:\n' +
            '1. Your backend is running on port 8000\n' +
            '2. Using Android emulator with 10.0.2.2\n' +
            '3. Or use your computer IP (e.g., 192.168.1.x) for physical devices'
        );
      }
    }
    throw error;
  }
};

const refreshAccessToken = async (): Promise<boolean> => {
  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      console.log('[Auth] No refresh token available');
      return false;
    }

    console.log('[Auth] Attempting to refresh access token');
    const response = await fetch(`${API_BASE_URL}/auth/refresh/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `refresh_token=${refreshToken}`,
      },
    });

    if (!response.ok) {
      console.log('[Auth] Token refresh failed:', response.status);
      return false;
    }

    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const cookies = setCookieHeader.split(',');
      const { accessToken, refreshToken: newRefreshToken } = parseSetCookieHeader(cookies);

      if (accessToken && newRefreshToken) {
        await storeTokens(accessToken, newRefreshToken);
        console.log('[Auth] Tokens refreshed successfully');
        return true;
      }
    }

    console.log('[Auth] No tokens found in refresh response');
    return false;
  } catch (error) {
    console.error('[Auth] Error refreshing token:', error);
    return false;
  }
};

export const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
  const makeRequest = async (isRetry = false): Promise<Response> => {
    const accessToken = await getAccessToken();
    const refreshToken = await getRefreshToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (accessToken && refreshToken) {
      headers['Cookie'] = `access_token=${accessToken}; refresh_token=${refreshToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && !isRetry) {
      console.log('[Auth] Received 401, attempting token refresh');

      const refreshSuccess = await refreshAccessToken();

      if (refreshSuccess) {
        console.log('[Auth] Token refresh successful, retrying request');
        return makeRequest(true);
      } else {
        console.log('[Auth] Token refresh failed, clearing tokens');
        await clearTokens();
        throw new Error('Authentication expired. Please login again.');
      }
    }

    return response;
  };

  return makeRequest();
};

/**
 * Logout user by calling backend logout endpoint and clearing local tokens
 */
export const logoutApi = async (): Promise<void> => {
  try {
    console.log('[Auth] Logging out user');

    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        const response = await fetch(`${API_BASE_URL}/auth/logout/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `refresh_token=${refreshToken}`,
          },
        });

        if (response.ok) {
          console.log('[Auth] Server logout successful');
        } else {
          console.warn('[Auth] Server logout failed, but continuing with local cleanup');
        }
      }
    } catch (serverError) {
      console.warn('[Auth] Could not reach server for logout:', serverError);
      console.warn('[Auth] Continuing with local cleanup');
    }

    await clearTokens();

    try {
      console.log('[Auth] Clearing all cached data');
      await AsyncStorage.clear();
      console.log('[Auth] All cached data cleared successfully');
    } catch (cacheError) {
      console.warn('[Auth] Error clearing cache:', cacheError);
    }

    console.log('[Auth] Local tokens and cache cleared successfully');
  } catch (error) {
    console.error('[Auth] Error during logout:', error);

    try {
      await clearTokens();
      await AsyncStorage.clear();
    } catch (clearError) {
      console.error('[Auth] Error clearing tokens during failed logout:', clearError);
    }
    throw error;
  }
};
