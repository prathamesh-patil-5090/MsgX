import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CallProvider } from '../components/CallProvider';
import '../global.css';

export default function RootLayout() {
  return (
    <CallProvider>
      <StatusBar style="light" backgroundColor="#000000" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
          animation: 'slide_from_right',
        }}>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="login/index"
          options={{
            headerShown: false,
            title: 'Sign In',
          }}
        />
        <Stack.Screen
          name="register/index"
          options={{
            headerShown: false,
            title: 'Register',
            presentation: 'card',
          }}
        />

        <Stack.Screen
          name="profile/index"
          options={{
            headerShown: false,
            title: 'Profile',
          }}
        />
      </Stack>
    </CallProvider>
  );
}
