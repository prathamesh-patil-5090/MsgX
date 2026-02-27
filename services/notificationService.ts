import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';

// ─── Notification Channel IDs ──────────────────────────────────────────────

const CHANNEL_MESSAGES = 'messages';
const CHANNEL_CALLS = 'calls';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatNotificationData {
  type: 'new_message';
  conversationId: string;
  conversationName: string;
  isGroup: boolean;
}

export interface CallNotificationData {
  type: 'incoming_call';
  callId: string;
  callerName: string;
  conversationId?: string;
}

export type NotificationData = ChatNotificationData | CallNotificationData;

// ─── Configure default notification behaviour ──────────────────────────────

// When app is in foreground, show the notification as an alert + sound
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as unknown as NotificationData | undefined;

    // For incoming calls while in foreground, don't show banner
    // (the in-app IncomingCallScreen handles this)
    if (data?.type === 'incoming_call') {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

// ─── Service ───────────────────────────────────────────────────────────────

class NotificationService {
  private isInitialized = false;
  private notificationListener: Notifications.EventSubscription | null = null;
  private responseListener: Notifications.EventSubscription | null = null;

  /**
   * Initialize notification channels and request permissions.
   * Call once at app startup (e.g. in root _layout).
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // ── Android notification channels ────────────────────────────
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_MESSAGES, {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
        enableLights: true,
        lightColor: '#4A9EFF',
      });

      await Notifications.setNotificationChannelAsync(CHANNEL_CALLS, {
        name: 'Incoming Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 1000, 1000, 1000],
        sound: 'incoming_call.mp3', // custom sound bundled via plugin
        enableLights: true,
        lightColor: '#4AFF4A',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    }

    // ── Request permissions ──────────────────────────────────────
    await this.requestPermissions();

    // ── Setup response listener (user taps notification) ────────
    this.responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as unknown as
        | NotificationData
        | undefined;
      if (!data) return;

      if (data.type === 'new_message') {
        router.push({
          pathname: '/chat/[id]',
          params: {
            id: data.conversationId,
            name: data.conversationName,
            type: data.isGroup ? 'group' : 'dm',
          },
        });
      }
      // For incoming_call taps the CallProvider already handles the UI
    });

    this.isInitialized = true;
    console.log('[NotificationService] Initialized');
  }

  /**
   * Request notification permissions from the user.
   */
  async requestPermissions(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[NotificationService] Notification permissions not granted');
      return false;
    }

    return true;
  }

  // ── Local notification senders ───────────────────────────────────

  /**
   * Show a notification for a new chat message.
   */
  async notifyNewMessage(
    conversationId: string,
    conversationName: string,
    senderName: string,
    messageContent: string,
    isGroup: boolean
  ): Promise<void> {
    const title = isGroup ? conversationName : senderName;
    const body = isGroup ? `${senderName}: ${messageContent}` : messageContent;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: {
          type: 'new_message',
          conversationId,
          conversationName,
          isGroup,
        } as unknown as Record<string, unknown>,
        ...(Platform.OS === 'android' && { channelId: CHANNEL_MESSAGES }),
      },
      trigger: null, // show immediately
    });
  }

  /**
   * Show a notification for an incoming voice call.
   * Only used when app is in background/killed —
   * in foreground the in-app UI handles it directly.
   */
  async notifyIncomingCall(
    callId: string,
    callerName: string,
    conversationId?: string
  ): Promise<string> {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Incoming Call',
        body: `${callerName} is calling you`,
        sound: Platform.OS === 'android' ? 'incoming_call.mp3' : 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: true,
        data: {
          type: 'incoming_call',
          callId,
          callerName,
          conversationId,
        } as unknown as Record<string, unknown>,
        ...(Platform.OS === 'android' && { channelId: CHANNEL_CALLS }),
      },
      trigger: null,
    });

    return id;
  }

  /**
   * Dismiss the incoming call notification (when call is answered/rejected/missed).
   */
  async dismissCallNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.dismissNotificationAsync(notificationId);
    } catch (e) {
      // Notification may already be dismissed
    }
  }

  /**
   * Dismiss all notifications for a specific conversation (when user opens it).
   */
  async dismissConversationNotifications(conversationId: string): Promise<void> {
    try {
      const presented = await Notifications.getPresentedNotificationsAsync();
      for (const n of presented) {
        const data = n.request.content.data as unknown as NotificationData | undefined;
        if (
          data?.type === 'new_message' &&
          (data as ChatNotificationData).conversationId === conversationId
        ) {
          await Notifications.dismissNotificationAsync(n.request.identifier);
        }
      }
    } catch (e) {
      console.warn('[NotificationService] Error dismissing notifications:', e);
    }
  }

  /**
   * Get current badge count.
   */
  async getBadgeCount(): Promise<number> {
    return Notifications.getBadgeCountAsync();
  }

  /**
   * Set badge count.
   */
  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count);
  }

  /**
   * Tear down listeners. Call on app unmount if needed.
   */
  cleanup(): void {
    this.notificationListener?.remove();
    this.responseListener?.remove();
    this.notificationListener = null;
    this.responseListener = null;
    this.isInitialized = false;
  }
}

// Singleton export
export const notificationService = new NotificationService();
