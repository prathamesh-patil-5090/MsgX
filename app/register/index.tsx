import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAccessToken, getRefreshToken, registerApi } from 'services/loginApi';

export default function RegisterIndex() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    if (!firstName || !lastName || !email || !username || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setIsLoading(true);
    try {
      const response = await registerApi({
        first_name: firstName,
        last_name: lastName,
        email: email,
        username: username,
        password: password,
      });
      console.log('Register successful:', response);

      // Small delay to ensure tokens are stored
      setTimeout(() => {
        router.replace('/(tabs)/dm/');
      }, 100);
    } catch (error) {
      console.error('Register error:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred during registration. Please try again.';

      // Handle specific AsyncStorage errors
      if (errorMessage.includes('[AsyncStorage]') || errorMessage.includes('null/undefined')) {
        Alert.alert(
          'Registration Error',
          'There was an issue storing your registration information. Please try registering again.'
        );
      } else {
        Alert.alert('Registration Failed', errorMessage);
      }
    } finally {
      setIsLoading(false);
    }

    console.log('Registering with:', { firstName, lastName, email, username, password });
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
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View className="flex-1 items-center justify-center px-8 py-12">
            {/* Logo/Brand Section */}
            <View className="mb-8 items-center">
              <View
                style={{
                  width: 144,
                  height: 144,
                  borderRadius: 72,
                  backgroundColor: '#4A9EFF',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                <Text
                  style={{
                    fontSize: 48,
                    fontWeight: 'bold',
                    color: 'white',
                  }}>
                  MX
                </Text>
              </View>
            </View>

            {/* Registration Card */}
            <View className="w-full max-w-md">
              <Text className="mb-2 text-3xl font-bold text-white">Create Account</Text>
              <Text className="mb-8 text-base text-gray-400">Sign up to get started</Text>

              {/* First Name Input */}
              <View className="flex flex-row gap-5">
                <View className="mb-6">
                  <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">
                    FIRST NAME
                  </Text>
                  <TextInput
                    className="rounded-xl border-2 border-white/20 bg-white/10 px-5 py-4 text-base text-white"
                    placeholder="Enter your first name"
                    placeholderTextColor="#999999"
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                    accessibilityLabel="First name input"
                    accessible
                  />
                </View>

                {/* Last Name Input */}
                <View className="mb-6">
                  <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">
                    LAST NAME
                  </Text>
                  <TextInput
                    className="rounded-xl border-2 border-white/20 bg-white/10 px-5 py-4 text-base text-white"
                    placeholder="Enter your last name"
                    placeholderTextColor="#999999"
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                    accessibilityLabel="Last name input"
                    accessible
                  />
                </View>
              </View>

              {/* Email Input */}
              <View className="mb-6">
                <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">
                  EMAIL
                </Text>
                <TextInput
                  className="rounded-xl border-2 border-white/20 bg-white/10 px-5 py-4 text-base text-white"
                  placeholder="Enter your email"
                  placeholderTextColor="#999999"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  accessibilityLabel="Email input"
                  accessible
                />
              </View>

              {/* Username Input */}
              <View className="mb-6">
                <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-white">
                  USERNAME
                </Text>
                <TextInput
                  className="rounded-xl border-2 border-white/20 bg-white/10 px-5 py-4 text-base text-white"
                  placeholder="Choose a username"
                  placeholderTextColor="#999999"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  accessibilityLabel="Username input"
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
                  placeholder="Create a password"
                  placeholderTextColor="#999999"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  accessibilityLabel="Password input"
                  accessible
                />
              </View>

              {/* Sign Up Button */}
              <TouchableOpacity
                className="mb-6 items-center rounded-xl bg-white py-5 active:opacity-80"
                onPress={handleRegister}
                activeOpacity={0.8}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Sign up">
                {isLoading ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text className="text-base font-bold uppercase tracking-widest text-black">
                    SIGN UP
                  </Text>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View className="mb-6 flex-row items-center">
                <View className="h-px flex-1 bg-white/20" />
                <Text className="mx-4 text-sm text-gray-500">OR</Text>
                <View className="h-px flex-1 bg-white/20" />
              </View>

              {/* Sign In Link */}
              <View className="flex-row justify-center">
                <Text className="text-sm text-gray-400">Already have an account? </Text>
                <Link href="/" asChild>
                  <TouchableOpacity accessibilityRole="button" disabled={isLoading}>
                    <Text className="text-sm font-semibold text-white">Sign In</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>

            {/* Footer */}
            <View className="mt-8">
              <Text className="text-xs text-gray-600">© 2024 MsgX. All rights reserved.</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
