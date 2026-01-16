import { Link, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
// import AppIcon from '../../assets/splash.png';
import '../../global.css';
import { getAccessToken, getRefreshToken, loginApi } from '../../services/loginApi';

export default function LoginIndex() {
  const router = useRouter();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!emailOrUsername || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsLoading(true);
    try {
      const response = await loginApi({
        username_or_email: emailOrUsername,
        password: password,
      });
      console.log('Login successful:', response);

      // Small delay to ensure tokens are stored
      setTimeout(() => {
        router.replace('/(tabs)/dm/');
      }, 100);
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred during login. Please try again.';

      // Handle specific AsyncStorage errors
      if (errorMessage.includes('[AsyncStorage]') || errorMessage.includes('null/undefined')) {
        Alert.alert(
          'Login Error',
          'There was an issue storing your login information. Please try logging in again.'
        );
      } else {
        Alert.alert('Login Failed', errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const redirectToHome = async (): Promise<void> => {
      try {
        const accessToken = await getAccessToken();
        const refreshToken = await getRefreshToken();
        if (accessToken && refreshToken) {
          console.log('User already logged in, redirecting...');
          router.replace('/(tabs)/dm/');
        }
      } catch (error) {
        console.error('Error checking existing login:', error);
        // Clear any corrupted tokens
        try {
          const { clearTokens } = await import('../../services/loginApi');
          await clearTokens();
        } catch (clearError) {
          console.error('Error clearing corrupted tokens:', clearError);
        }
      }
    };
    redirectToHome();
  }, [router]);

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1">
        <View className="flex-1 items-center justify-center px-8">
          {/* Logo/Brand Section */}
          <View className="items-center">
            <Image
              source={require('../../assets/splash.png')}
              style={{
                width: 100,
                height: 100,
              }}
            />
          </View>

          {/* Login Card */}
          <View className="w-full max-w-md">
            <View className="mb-8 items-center">
              <Text className="mb-2 text-3xl font-bold text-white">Sign In MsgX</Text>
            </View>

            {/* Email/Username Input */}
            <View className="mb-6">
              <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">
                EMAIL OR USERNAME
              </Text>
              <TextInput
                className="rounded-xl border-2 border-white/20 bg-white/10 px-5 py-4 text-base text-white"
                placeholder="Enter your email or username"
                placeholderTextColor="#999999"
                value={emailOrUsername}
                onChangeText={setEmailOrUsername}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!isLoading}
                accessibilityLabel="Email or Username input"
                accessible
              />
            </View>

            {/* Password Input */}
            <View className="mb-8">
              <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">
                PASSWORD
              </Text>
              <TextInput
                className="rounded-xl border-2 border-white/20 bg-white/10 px-5 py-4 text-base text-white"
                placeholder="Enter your password"
                placeholderTextColor="#999999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                editable={!isLoading}
                accessibilityLabel="Password input"
                accessible
              />
            </View>

            {/* Sign In Button */}
            <TouchableOpacity
              className="mb-6 items-center rounded-xl bg-white py-5 active:opacity-80"
              onPress={handleLogin}
              activeOpacity={0.8}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Sign in">
              {isLoading ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text className="text-base font-bold uppercase tracking-widest text-black">
                  SIGN IN
                </Text>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View className="mb-6 flex-row items-center">
              <View className="h-px flex-1 bg-white/20" />
              <Text className="mx-4 text-sm text-gray-500">OR</Text>
              <View className="h-px flex-1 bg-white/20" />
            </View>

            {/* Sign Up Link */}
            <View className="flex-row justify-center">
              <Text className="text-sm text-gray-400">Don&apos;t have an account? </Text>
              <Link href="/register" asChild>
                <TouchableOpacity accessibilityRole="button" disabled={isLoading}>
                  <Text className="text-sm font-semibold text-white">Sign Up</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>

          {/* Footer */}
          <View className="absolute bottom-8">
            <Text className="text-xs text-gray-600">© 2024 MsgX. All rights reserved.</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
