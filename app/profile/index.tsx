import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withAuthErrorHandling } from 'services/authUtils';
import { logoutApi } from 'services/loginApi';
import { getCurrentUserProfile, type UserProfile } from 'services/userApi';
import '../../global.css';

export default function ProfileIndex() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const result = await withAuthErrorHandling(async () => {
      const response = await getCurrentUserProfile();
      return response;
    });

    if (result) {
      setUserProfile(result.user);
    } else {
      setError('Failed to load profile');
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    // Check if profile data was passed via navigation params
    if (params.profileData) {
      try {
        const passedProfile = JSON.parse(params.profileData as string);
        console.log('[Profile] Using passed profile data:', passedProfile);
        setUserProfile(passedProfile);
        setLoading(false);
        return;
      } catch (parseError) {
        console.warn('[Profile] Failed to parse passed profile data:', parseError);
      }
    }

    // No passed data or parsing failed, load from API
    loadProfile();
  }, [params.profileData]);

  const handleRefresh = () => {
    loadProfile(true);
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: confirmLogout,
        },
      ],
      { cancelable: true }
    );
  };

  const confirmLogout = async () => {
    try {
      setLoggingOut(true);
      await logoutApi();

      // Clear any cached data
      // Note: You might want to add more cache clearing here
      console.log('Logout successful, redirecting to login');

      router.replace('/login');
    } catch (error) {
      console.error('Logout error:', error);
      Alert.alert('Logout Error', 'There was an issue logging out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const getUserInitials = (firstName: string, lastName: string): string => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
        <View className="flex-row items-center border-b border-gray-800 px-4 py-3">
          <TouchableOpacity onPress={handleBack} className="mr-3">
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text className="flex-1 text-xl font-semibold text-white">Profile</Text>
        </View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#4A9EFF" />
          <Text className="mt-4 text-gray-400">Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !userProfile) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
        <View className="flex-row items-center border-b border-gray-800 px-4 py-3">
          <TouchableOpacity onPress={handleBack} className="mr-3">
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text className="flex-1 text-xl font-semibold text-white">Profile</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Ionicons name="person-circle-outline" size={80} color="#666666" />
          <Text className="mt-4 text-center text-lg font-semibold text-white">
            Failed to Load Profile
          </Text>
          <Text className="mt-2 text-center text-gray-400">
            {error || 'Could not fetch your profile information'}
          </Text>
          <TouchableOpacity
            onPress={() => loadProfile()}
            className="mt-6 rounded-lg bg-blue-600 px-6 py-3">
            <Text className="font-semibold text-white">Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      {/* Header */}
      <View className="flex-row items-center border-b border-gray-800 px-4 py-3">
        <TouchableOpacity onPress={handleBack} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="flex-1 text-xl font-semibold text-white">Profile</Text>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#4A9EFF"
            colors={['#4A9EFF']}
          />
        }>
        {/* Profile Header */}
        <View className="items-center border-b border-gray-800 bg-gray-900 px-6 py-8">
          {/* Avatar */}
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: '#4A9EFF',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 16,
            }}>
            <Text
              style={{
                fontSize: 48,
                fontWeight: 'bold',
                color: 'white',
              }}>
              {getUserInitials(userProfile.first_name, userProfile.last_name)}
            </Text>
          </View>

          {/* Name */}
          <Text className="mb-2 text-2xl font-bold text-white">
            {userProfile.first_name} {userProfile.last_name}
          </Text>

          {/* Username */}
          <Text className="mb-1 text-lg text-gray-400">@{userProfile.username}</Text>

          {/* User ID */}
          <Text className="text-sm text-gray-500">ID: {userProfile.id}</Text>
        </View>

        {/* Profile Information */}
        <View className="px-6 py-6">
          <Text className="mb-4 text-lg font-semibold text-white">Account Information</Text>

          {/* Email */}
          <View className="mb-6 flex-row items-center rounded-lg bg-gray-900 p-4">
            <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-blue-600">
              <Ionicons name="mail" size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-400">Email</Text>
              <Text className="text-base text-white">{userProfile.email}</Text>
            </View>
          </View>

          {/* Username */}
          <View className="mb-6 flex-row items-center rounded-lg bg-gray-900 p-4">
            <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-green-600">
              <Ionicons name="person" size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-400">Username</Text>
              <Text className="text-base text-white">@{userProfile.username}</Text>
            </View>
          </View>

          {/* First Name */}
          <View className="mb-6 flex-row items-center rounded-lg bg-gray-900 p-4">
            <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-purple-600">
              <Ionicons name="person-outline" size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-400">First Name</Text>
              <Text className="text-base text-white">{userProfile.first_name}</Text>
            </View>
          </View>

          {/* Last Name */}
          <View className="mb-6 flex-row items-center rounded-lg bg-gray-900 p-4">
            <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-orange-600">
              <Ionicons name="person-outline" size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-400">Last Name</Text>
              <Text className="text-base text-white">{userProfile.last_name}</Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View className="px-6 pb-8">
          <Text className="mb-4 text-lg font-semibold text-white">Actions</Text>

          {/* Logout Button */}
          <TouchableOpacity
            onPress={handleLogout}
            disabled={loggingOut}
            className="flex-row items-center rounded-lg bg-red-600 p-4"
            style={{ opacity: loggingOut ? 0.7 : 1 }}>
            {loggingOut ? (
              <ActivityIndicator size="small" color="white" style={{ marginRight: 12 }} />
            ) : (
              <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-red-700">
                <Ionicons name="log-out" size={20} color="white" />
              </View>
            )}
            <View className="flex-1">
              <Text className="text-base font-semibold text-white">
                {loggingOut ? 'Logging out...' : 'Logout'}
              </Text>
              <Text className="text-sm text-red-200">Sign out of your account</Text>
            </View>
            {!loggingOut && <Ionicons name="chevron-forward" size={20} color="white" />}
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View className="border-t border-gray-800 px-6 py-6">
          <Text className="text-center text-xs text-gray-600">
            © 2024 MsgX. All rights reserved.
          </Text>
          <Text className="mt-1 text-center text-xs text-gray-600">Version 1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
