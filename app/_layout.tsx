import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { CallProvider } from '../components/CallProvider';
import { notificationService } from '../services/notificationService';
import { getUserId } from '../services/loginApi';
import {
  conversationsWebSocketService,
  ConversationsWSEvent,
} from '../services/conversationsWebSocket';
import '../global.css';

export default function RootLayout() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Keep pathname ref in sync
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Initialize notifications + global new-message listener
  useEffect(() => {
    let unsubscribeWS: (() => void) | null = null;

    const setup = async () => {
      await notificationService.initialize();

      // Subscribe to conversation updates for notifications
      unsubscribeWS = conversationsWebSocketService.onEvent(async (event: ConversationsWSEvent) => {
        if (event.type !== 'conversation_update' || event.action !== 'new_message') return;

        const conv = event.conversation;
        const msg = conv.latest_message;
        if (!msg) return;

        // Don't notify for our own messages
        const myId = await getUserId();
        if (myId && msg.sender_id.toString() === myId) return;

        // Don't notify if the user has the specific chat open & app is active
        const currentPath = pathnameRef.current;
        const isInChat = currentPath === `/chat/${conv.id}`;
        if (isInChat && appStateRef.current === 'active') return;

        const conversationName = conv.name || msg.sender_name || `Conversation ${conv.id}`;
        const isGroup = conv.is_group ?? false;

        await notificationService.notifyNewMessage(
          conv.id.toString(),
          conversationName,
          msg.sender_name,
          msg.content,
          isGroup
        );
      });
    };

    setup().catch(console.error);

    // Track app state for notification suppression
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      appStateRef.current = next;
    });

    return () => {
      unsubscribeWS?.();
      subscription.remove();
    };
  }, []);

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
