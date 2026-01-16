import { authenticatedFetch } from './loginApi';

import AsyncStorage from '@react-native-async-storage/async-storage';
export interface UserSearchResult {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
}

export interface UserSearchResponse {
  message: string;
  users: UserSearchResult[];
  count: number;
}

export interface UserProfile {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
}

export interface UserProfileResponse {
  message: string;
  user: UserProfile;
}

/**
 * Search for users by username, email, first name, last name, or user ID
 * @param searchParams - The search query (can be username, email, name, or ID)
 * @returns List of matching users
 */
export const searchUsers = async (searchParams: string): Promise<UserSearchResponse> => {
  try {
    console.log(`[userApi] Searching for users with query: ${searchParams}`);

    const response = await authenticatedFetch(
      `/auth/search/?search_params=${encodeURIComponent(searchParams)}`,
      {
        method: 'GET',
      }
    );

    console.log(`[userApi] Response status:`, response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[userApi] Failed to search users:', errorData);
      throw new Error(
        errorData.message || errorData.error || `Failed to search users: ${response.status}`
      );
    }

    const data: UserSearchResponse = await response.json();
    console.log(`[userApi] Found ${data.count} user(s)`);

    return data;
  } catch (error) {
    console.error('[userApi] Error searching users:', error);
    throw error;
  }
};

/**
 * Get user details by ID
 * @param userId - The user ID
 * @returns User details
 */
export const getUserById = async (userId: number): Promise<UserSearchResult> => {
  try {
    console.log(`[userApi] Fetching user with ID: ${userId}`);

    const response = await authenticatedFetch(`/auth/users/${userId}/`, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[userApi] Failed to fetch user:', errorData);
      throw new Error(
        errorData.message || errorData.error || `Failed to fetch user: ${response.status}`
      );
    }

    const data: UserSearchResult = await response.json();
    console.log(`[userApi] User fetched successfully`);

    return data;
  } catch (error) {
    console.error('[userApi] Error fetching user:', error);
    throw error;
  }
};

/**
 * Get all users from the platform
 * @returns List of all users
 */
export const getAllUsers = async (): Promise<UserSearchResponse> => {
  try {
    console.log(`[userApi] Fetching all users`);

    const response = await authenticatedFetch('/auth/users/', {
      method: 'GET',
    });

    console.log(`[userApi] Response status:`, response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[userApi] Failed to fetch users:', errorData);
      throw new Error(
        errorData.message || errorData.error || `Failed to fetch users: ${response.status}`
      );
    }

    const data: UserSearchResponse = await response.json();
    console.log(`[userApi] Found ${data.count} user(s)`);

    return data;
  } catch (error) {
    console.error('[userApi] Error fetching users:', error);
    throw error;
  }
};

/**
 * Get current user's profile
 * @returns Current user profile data
 */
export const getCurrentUserProfile = async (): Promise<UserProfileResponse> => {
  try {
    console.log(`[userApi] Fetching current user profile`);

    const response = await authenticatedFetch('/auth/profile/', {
      method: 'GET',
    });

    console.log(`[userApi] Response status:`, response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[userApi] Failed to fetch profile:', errorData);
      throw new Error(
        errorData.message || errorData.error || `Failed to fetch profile: ${response.status}`
      );
    }

    const data: UserProfileResponse = await response.json();
    console.log(`[userApi] Profile fetched successfully`);
    await AsyncStorage.setItem('USER', JSON.stringify(data));
    return data;
  } catch (error) {
    console.error('[userApi] Error fetching profile:', error);
    throw error;
  }
};
