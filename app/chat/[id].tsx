import { Entypo, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AvatarImage from 'components/AvatarImage';
import { useCall } from 'components/CallProvider';
import OptionsModal from 'components/OptionsModal';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmojiPicker, { type EmojiType } from 'rn-emoji-keyboard';
import { cacheMessagesForSearch } from 'services/cacheService';
import { fetchConversationById, fetchParticipants } from 'services/conversationsApi';
import { getAccessToken, getUserId } from 'services/loginApi';
import { notificationService } from 'services/notificationService';
import {
  deleteMessage,
  fetchMessages,
  markMessageAsRead,
  sendMessage,
  updateMessage,
  type MessageResponse,
} from 'services/messagesApi';
import { websocketService, type WebSocketResponse } from 'services/websocket';
import '../../global.css';

const getUserIdFromToken = async (): Promise<number | null> => {
  try {
    const token = await getAccessToken();
    if (!token) return null;

    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    const payload = JSON.parse(jsonPayload);
    const userId = payload.user_id;
    return userId ? parseInt(userId.toString()) : null;
  } catch (error) {
    console.error('Error decoding token:', error);
    return null;
  }
};

interface Message {
  id: string;
  text: string;
  sender: 'me' | 'other';
  sender_id?: number;
  sender_name?: string;
  timestamp: string;
  temp_id?: string;
  isPending?: boolean;
  is_read?: boolean;
}

const formatMessageTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const convertApiMessageToUIMessage = (
  apiMessage: MessageResponse,
  currentUserId: number
): Message => {
  const senderId = apiMessage.sender.id;
  const senderName = `${apiMessage.sender.first_name} ${apiMessage.sender.last_name}`.trim();
  const isMe = senderId === currentUserId;

  return {
    id: apiMessage.id.toString(),
    text: apiMessage.content,
    sender: isMe ? 'me' : 'other',
    sender_id: senderId,
    sender_name: senderName,
    timestamp: formatMessageTime(apiMessage.created_at),
    isPending: false,
  };
};

/**
 * Process raw API messages: deduplicate DB vs Kafka overlap, sort chronologically.
 *
 * The backend may return the SAME message from both the DB (real auto-increment ID,
 * valid `created_at`) and the Kafka pending queue (fake sequential ID, `null`
 * `created_at` for WS-originated messages). This helper:
 *   1. Separates messages with a valid timestamp (DB) from those without (Kafka pending).
 *   2. Drops any Kafka-pending entry whose content+sender already appears in the DB set.
 *   3. Sorts DB messages oldest→newest, appends unique pending messages at the end.
 */
const processApiMessages = (results: MessageResponse[], userId: number): Message[] => {
  const withTime: MessageResponse[] = [];
  const withoutTime: MessageResponse[] = [];

  for (const msg of results) {
    const t = msg.created_at ? new Date(msg.created_at).getTime() : NaN;
    if (!isNaN(t)) {
      withTime.push(msg);
    } else {
      withoutTime.push(msg);
    }
  }

  const dbSignatures = new Set(withTime.map((m) => `${m.sender.id}|${m.content}`));

  const uniquePending = withoutTime.filter((m) => !dbSignatures.has(`${m.sender.id}|${m.content}`));

  const combined = [
    ...withTime.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    ...uniquePending,
  ];

  return combined.map((msg) => convertApiMessageToUIMessage(msg, userId));
};

/**
 * Deduplicate messages array by id.
 * For WS messages (id starts with 'ws_' or 'pending_'), if an API message
 * with matching content+sender exists, the WS version is dropped.
 */
const deduplicateMessages = (msgs: Message[]): Message[] => {
  const seen = new Map<string, number>();
  const result: Message[] = [];

  for (const msg of msgs) {
    const existingIdx = seen.get(msg.id);
    if (existingIdx !== undefined) {
      if (msg.isPending) continue;
      result[existingIdx] = msg;
    } else {
      seen.set(msg.id, result.length);
      result.push(msg);
    }
  }

  const apiSignatures = new Set<string>();
  for (const msg of result) {
    if (!msg.id.startsWith('ws_') && !msg.id.startsWith('pending_')) {
      apiSignatures.add(`${msg.sender_id}|${msg.text}`);
    }
  }

  return result.filter((msg) => {
    if (msg.id.startsWith('ws_') || msg.id.startsWith('pending_')) {
      return !apiSignatures.has(`${msg.sender_id}|${msg.text}`);
    }
    return true;
  });
};

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { id, name, type, messageId, highlightMessage } = params;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const chatName = (name as string) || 'Chat';
  const isGroup = type === 'group';

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const currentUserIdRef = useRef<number | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastReadMessageId, setLastReadMessageId] = useState<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const { initiateCall, initiateGroupCall, isInCall } = useCall();
  const [isStartingCall, setIsStartingCall] = useState(false);

  const handleVoiceCall = useCallback(async () => {
    if (isInCall || isStartingCall) return;

    const conversationId = Array.isArray(id) ? id[0] : (id as string);
    if (!conversationId || !currentUserId) {
      Alert.alert('Error', 'Unable to start call. Please try again.');
      return;
    }

    setIsStartingCall(true);
    try {
      if (isGroup) {
        const participants = await fetchParticipants(parseInt(conversationId));
        const participantIds = participants.map((p) => p.user.id);

        if (participantIds.length <= 1) {
          Alert.alert('Error', 'Not enough participants for a group call.');
          return;
        }

        const groupDisplayName = chatName || 'Group Call';
        await initiateGroupCall(participantIds, 'Me', conversationId, groupDisplayName);
      } else {
        const conversation = await fetchConversationById(parseInt(conversationId));

        if (!conversation.other_participant) {
          Alert.alert('Error', 'Could not find the other participant.');
          return;
        }

        const calleeId = conversation.other_participant.id;
        const callerName = 'Me';
        const calleeDisplayName =
          `${conversation.other_participant.first_name} ${conversation.other_participant.last_name}`.trim() ||
          conversation.other_participant.username;

        await initiateCall(calleeId, callerName, calleeDisplayName, conversationId);
      }
    } catch (error: any) {
      console.error('Failed to initiate call:', error);
      const message = error?.message || 'Failed to start call. Please try again.';
      Alert.alert('Call Failed', message);
    } finally {
      setIsStartingCall(false);
    }
  }, [
    id,
    isGroup,
    isInCall,
    isStartingCall,
    currentUserId,
    initiateCall,
    initiateGroupCall,
    chatName,
  ]);

  const handleVideoCall = useCallback(async () => {
    if (isInCall || isStartingCall) return;

    const conversationId = Array.isArray(id) ? id[0] : (id as string);
    if (!conversationId || !currentUserId) {
      Alert.alert('Error', 'Unable to start call. Please try again.');
      return;
    }

    setIsStartingCall(true);
    try {
      if (isGroup) {
        const participants = await fetchParticipants(parseInt(conversationId));
        const participantIds = participants.map((p) => p.user.id);

        if (participantIds.length <= 1) {
          Alert.alert('Error', 'Not enough participants for a group call.');
          return;
        }

        const groupDisplayName = chatName || 'Group Call';
        await initiateGroupCall(participantIds, 'Me', conversationId, groupDisplayName, true);
      } else {
        const conversation = await fetchConversationById(parseInt(conversationId));

        if (!conversation.other_participant) {
          Alert.alert('Error', 'Could not find the other participant.');
          return;
        }

        const calleeId = conversation.other_participant.id;
        const callerName = 'Me';
        const calleeDisplayName =
          `${conversation.other_participant.first_name} ${conversation.other_participant.last_name}`.trim() ||
          conversation.other_participant.username;

        await initiateCall(calleeId, callerName, calleeDisplayName, conversationId, true);
      }
    } catch (error: any) {
      console.error('Failed to initiate video call:', error);
      const message = error?.message || 'Failed to start video call. Please try again.';
      Alert.alert('Call Failed', message);
    } finally {
      setIsStartingCall(false);
    }
  }, [
    id,
    isGroup,
    isInCall,
    isStartingCall,
    currentUserId,
    initiateCall,
    initiateGroupCall,
    chatName,
  ]);

  const getCacheKey = (conversationId: string) => `messages_${conversationId}`;

  const loadCachedMessages = async (
    conversationId: string,
    userId: number
  ): Promise<Message[] | null> => {
    try {
      const cacheKey = getCacheKey(conversationId);
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        console.log(`Loaded ${cachedData.messages.length} cached messages`);
        setMessages(cachedData.messages);
        setNextPage(cachedData.nextPage);
        return cachedData.messages as Message[];
      }
      return null;
    } catch (error) {
      console.error('Error loading cached messages:', error);
      return null;
    }
  };

  const cacheMessages = async (conversationId: string, msgs: Message[], page: string | null) => {
    try {
      const cacheKey = getCacheKey(conversationId);
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({
          messages: msgs,
          nextPage: page,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      console.error('Error caching messages:', error);
    }
  };

  const syncCache = (updatedMessages?: Message[]) => {
    const conversationId = Array.isArray(id) ? id[0] : (id as string);
    if (!conversationId) return;
    const msgs = updatedMessages ?? messages;
    cacheMessages(conversationId, msgs, nextPage).catch(console.error);

    const searchMsgs = msgs
      .filter((m) => m.sender_id !== undefined && m.sender_name !== undefined)
      .map((m) => ({
        id: m.id,
        content: m.text,
        senderId: m.sender_id || 0,
        senderName: m.sender_name || chatName,
        timestamp: m.timestamp,
      }));
    cacheMessagesForSearch(conversationId, chatName, searchMsgs, isGroup ? 'group' : 'dm').catch(
      console.error
    );
  };

  const loadMessages = async (conversationId: string, userId: number, showRefreshing = false) => {
    try {
      if (!showRefreshing) {
        setIsLoadingMessages(true);
      }

      const response = await fetchMessages(parseInt(conversationId));

      if (!response || !response.results || !Array.isArray(response.results)) {
        console.error('Invalid or empty response:', response);
        if (!showRefreshing) setMessages([]);
        return [];
      }

      const uiMessages = processApiMessages(response.results, userId);

      setMessages((prev) => {
        if (showRefreshing) {
          const apiIds = new Set(uiMessages.map((m) => m.id));
          const pendingMsgs = prev.filter(
            (m) => (m.id.startsWith('ws_') || m.id.startsWith('pending_')) && !apiIds.has(m.id)
          );
          return deduplicateMessages([...uiMessages, ...pendingMsgs]);
        } else {
          const optimistic = prev.filter(
            (m) => m.id.startsWith('pending_') || m.id.startsWith('ws_')
          );
          return deduplicateMessages([...uiMessages, ...optimistic]);
        }
      });
      setNextPage(response.next);
      await cacheMessages(conversationId, uiMessages, response.next);

      const searchMsgs = uiMessages.map((msg) => ({
        id: msg.id,
        content: msg.text,
        senderId: msg.sender_id || 0,
        senderName: msg.sender_name || chatName,
        timestamp: msg.timestamp,
      }));
      await cacheMessagesForSearch(conversationId, chatName, searchMsgs, isGroup ? 'group' : 'dm');

      return uiMessages;
    } catch (error) {
      console.error('Error loading messages:', error);
      if (!showRefreshing) {
        const msg = error instanceof Error ? error.message : 'Failed to load messages';
        Alert.alert('Error', msg + '\n\nPlease check your connection and try again.');
      }
      return [];
    } finally {
      setIsLoadingMessages(false);
      setRefreshing(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!nextPage || isLoadingMore || !currentUserId || !id) return;

    try {
      setIsLoadingMore(true);

      const response = await fetch(nextPage, {
        headers: {
          'Content-Type': 'application/json',
          Cookie: `access_token=${await getAccessToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load more messages');
      }

      const data = await response.json();

      if (data.results && data.results.messages && Array.isArray(data.results.messages)) {
        const newMessages = processApiMessages(data.results.messages, currentUserId);

        const updatedMessages = deduplicateMessages([...newMessages, ...messages]);
        setMessages(updatedMessages);
        setNextPage(data.next);

        const conversationId = Array.isArray(id) ? id[0] : id;
        await cacheMessages(conversationId, updatedMessages, data.next);

        const searchCacheMessages = newMessages.map((msg: Message) => ({
          id: msg.id,
          content: msg.text,
          senderId: msg.sender_id || 0,
          senderName: msg.sender_name || chatName,
          timestamp: msg.timestamp,
        }));
        await cacheMessagesForSearch(
          conversationId,
          chatName,
          searchCacheMessages,
          isGroup ? 'group' : 'dm'
        );
      }
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      if (!id) return;

      const conversationIdStr = Array.isArray(id) ? id[0] : id;
      notificationService.dismissConversationNotifications(conversationIdStr).catch(console.error);

      try {
        let userIdStr = await getUserId();
        let userId: number | null = null;

        if (userIdStr) {
          userId = parseInt(userIdStr);
        } else {
          userId = await getUserIdFromToken();

          if (!userId) {
            Alert.alert('Error', 'User not logged in. Please login again.', [
              {
                text: 'OK',
                onPress: () => router.replace('/(auth)/login'),
              },
            ]);
            return;
          }
        }

        setCurrentUserId(userId);
        currentUserIdRef.current = userId;

        const conversationId = Array.isArray(id) ? id[0] : id;

        const cachedMsgs = await loadCachedMessages(conversationId, userId);

        const loadedMessages = (await loadMessages(conversationId, userId, !!cachedMsgs)) || [];

        if (highlightMessage === 'true' && messageId) {
          setHighlightedMessageId(Array.isArray(messageId) ? messageId[0] : messageId);

          setTimeout(() => {
            const msgIndex = messages.findIndex(
              (msg) => msg.id === (Array.isArray(messageId) ? messageId[0] : messageId)
            );
            if (msgIndex !== -1 && flatListRef.current) {
              flatListRef.current.scrollToIndex({
                index: msgIndex,
                animated: true,
                viewPosition: 0.5,
              });
            }
          }, 300);

          setTimeout(() => {
            setHighlightedMessageId(null);
          }, 3000);
        } else {
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }, 100);
        }

        if (loadedMessages.length > 0) {
          const latestMessage = loadedMessages[loadedMessages.length - 1];
          if (latestMessage.sender === 'other' && latestMessage.id) {
            const messageId = parseInt(latestMessage.id);
            try {
              await markMessageAsRead(parseInt(conversationId), messageId);
              setLastReadMessageId(messageId);
            } catch (error) {
              console.error('Error marking message as read:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error initializing chat:', error);
        Alert.alert('Error', 'Failed to initialize chat. Please try again.');
      }
    };

    initialize();
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const conversationId = Array.isArray(id) ? id[0] : id;

    const connectWebSocket = async () => {
      try {
        setIsConnecting(true);
        await websocketService.connect(conversationId);
      } catch (error) {
        console.error('Failed to connect WebSocket:', error);
        Alert.alert('Connection Error', 'Failed to connect to chat server');
      } finally {
        setIsConnecting(false);
      }
    };

    connectWebSocket();

    const unsubscribeMessage = websocketService.onMessage((data: WebSocketResponse) => {
      const currentUserIdValue = currentUserIdRef.current;

      setMessages((prev) => {
        const senderId = parseInt(data.sender_id.toString());
        const currentUserIdNum =
          currentUserIdValue !== null ? parseInt(currentUserIdValue.toString()) : null;
        const isFromMe = currentUserIdNum !== null && senderId === currentUserIdNum;

        const tempIdStr = data.temp_id.toString();

        if (prev.some((m) => m.id === `ws_${tempIdStr}`)) {
          return prev;
        }

        const hadPending = prev.some((m) => m.temp_id === tempIdStr);
        const filtered = hadPending ? prev.filter((m) => m.temp_id !== tempIdStr) : prev;

        const newMessage: Message = {
          id: `ws_${tempIdStr}`,
          text: data.message,
          sender: isFromMe ? 'me' : 'other',
          sender_id: data.sender_id,
          sender_name: data.sender_name ?? undefined,
          timestamp: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          temp_id: tempIdStr,
        };

        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }, 50);

        const updatedMessages = deduplicateMessages([...filtered, newMessage]);

        syncCache(updatedMessages);

        if (!isFromMe && id) {
          const conversationId = Array.isArray(id) ? id[0] : id;
          const numericId = parseInt(newMessage.id.replace('ws_', ''));
          if (!isNaN(numericId)) {
            markMessageAsRead(parseInt(conversationId), numericId)
              .then(() => {
                setLastReadMessageId(numericId);
              })
              .catch((error) => {
                console.error('Error marking message as read:', error);
              });
          }
        }

        return updatedMessages;
      });
    });

    const unsubscribeOpen = websocketService.onOpen(() => {
      setIsConnected(true);
      setIsConnecting(false);
    });

    const unsubscribeClose = websocketService.onClose(() => {
      setIsConnected(false);
    });

    const unsubscribeError = websocketService.onError((error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeOpen();
      unsubscribeClose();
      unsubscribeError();
      websocketService.disconnect();
    };
  }, [id]);

  const handleRefresh = async () => {
    if (!id || !currentUserId) return;
    const conversationId = Array.isArray(id) ? id[0] : id;
    await loadMessages(conversationId, currentUserId, true);
  };

  const toggleOpenOptionForMessage = (messageId: string) => {
    setSelectedMessageId((prev) => (prev === messageId ? null : messageId));
  };

  const handleEditMessage = async (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      setInputText(message.text);
      setEditingMessageId(messageId);
      setSelectedMessageId(null);
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => setSelectedMessageId(null),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMessage(Number(id), Number(messageId));

              setMessages((prev) => {
                const filtered = prev.filter((m) => m.id !== messageId);
                syncCache(filtered);
                return filtered;
              });
              setSelectedMessageId(null);
            } catch (error) {
              console.error('Error deleting message:', error);
              Alert.alert('Delete Failed', 'Could not delete message. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setInputText('');
  };

  const handlePick = (emojiObject: EmojiType) => {
    setInputText((prev) => prev + emojiObject.emoji);
    setIsOpen(false);
  };

  const handleSend = async () => {
    if (inputText.trim()) {
      if (editingMessageId) {
        const messageText = inputText.trim();
        try {
          const updatedMessage = await updateMessage(
            Number(id),
            Number(editingMessageId),
            messageText
          );

          setMessages((prev) => {
            const updated = prev.map((msg) =>
              msg.id === editingMessageId
                ? {
                    ...msg,
                    text: updatedMessage.content,
                    timestamp: new Date(updatedMessage.updated_at).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    }),
                  }
                : msg
            );
            syncCache(updated);
            return updated;
          });

          setEditingMessageId(null);
          setInputText('');
        } catch (error) {
          console.error('Error updating message:', error);
          Alert.alert('Update Failed', 'Could not update message. Please try again.');
        }
        return;
      }

      const messageText = inputText.trim();
      setInputText('');

      if (websocketService.isConnected()) {
        try {
          const tempId = websocketService.sendMessage(messageText);

          const optimisticMsg: Message = {
            id: `pending_${tempId}`,
            text: messageText,
            sender: 'me',
            sender_id: currentUserId ?? undefined,
            timestamp: new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }),
            temp_id: tempId,
            isPending: true,
          };
          setMessages((prev) => {
            const updated = [...prev, optimisticMsg];
            syncCache(updated);
            return updated;
          });
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
        } catch (error) {
          console.error('WebSocket send failed', error);
          await sendViaRest(messageText);
        }
      } else {
        await sendViaRest(messageText);
      }
    }
  };

  const sendViaRest = async (messageText: string) => {
    const tempId = `rest_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const userId = currentUserIdRef.current;

    const optimisticMsg: Message = {
      id: `pending_${tempId}`,
      text: messageText,
      sender: 'me',
      sender_id: userId ?? undefined,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      temp_id: tempId,
      isPending: true,
    };
    setMessages((prev) => {
      const updated = [...prev, optimisticMsg];
      syncCache(updated);
      return updated;
    });
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);

    try {
      const conversationId = Array.isArray(id) ? id[0] : (id as string);
      const response = await sendMessage(parseInt(conversationId), messageText);

      if (response && typeof response === 'object' && 'id' in response && 'sender' in response) {
        if (userId) {
          const uiMsg = convertApiMessageToUIMessage(response, userId);
          setMessages((prev) => {
            const updated = prev.map((m) => (m.id === `pending_${tempId}` ? uiMsg : m));
            syncCache(updated);
            return updated;
          });
        }
      }
    } catch (error) {
      console.error('REST send failed:', error);

      setMessages((prev) => {
        const updated = prev.filter((m) => m.id !== `pending_${tempId}`);
        syncCache(updated);
        return updated;
      });
      setInputText(messageText);
      Alert.alert('Send Failed', 'Could not send message. Please try again.');
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender === 'me';
    const isOptionsOpen = selectedMessageId === item.id;
    const displayName = isMe ? 'You' : item.sender_name || chatName;

    const messageIdNum = parseInt(item.id);
    const isRead = lastReadMessageId !== null && messageIdNum <= lastReadMessageId;

    const isHighlighted = highlightedMessageId === item.id;

    return (
      <View
        className={`mt-4 ${isMe ? 'items-end' : 'items-start'} px-4 ${isHighlighted ? 'rounded-lg bg-transparent py-2' : ''}`}>
        {!isMe && (
          <View className="mb-2 flex-row items-center">
            <AvatarImage source={null} name={displayName} size={32} />
            <Text className="ml-2 text-sm text-gray-400">{displayName}</Text>
          </View>
        )}
        <View className={`flex-row items-end ${isMe ? 'justify-end' : 'justify-start'}`}>
          <Pressable
            className={`max-w-[75%] rounded-2xl px-4 py-3 ${isMe ? 'bg-blue-600' : 'bg-gray-800'} ${isHighlighted ? 'border-2 border-yellow-500' : ''}`}
            onPress={() => toggleOpenOptionForMessage(item.id)}>
            <Text className="text-base text-white">{item.text}</Text>
          </Pressable>
          {isOptionsOpen && (
            <View className="ml-2">
              {item.sender_id === currentUserId && (
                <OptionsModal
                  messageId={item.id}
                  onEdit={() => handleEditMessage}
                  onDelete={handleDeleteMessage}
                />
              )}
            </View>
          )}
        </View>
        <View className={`mt-1 flex-row items-center ${isMe ? 'justify-end' : 'justify-start'}`}>
          <Text className={`text-xs text-gray-500`}>{item.timestamp}</Text>
          {isMe && (
            <View className="ml-1">
              {isRead ? (
                <Ionicons name="checkmark-done" size={14} color="#4A9EFF" />
              ) : (
                <Ionicons name="checkmark" size={14} color="#666" />
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 1}>
        <ImageBackground
          source={require('../../assets/background_Img.jpg')}
          className="flex-1"
          resizeMode="cover">
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-gray-800 bg-black px-4 py-3">
            <View className="flex-1 flex-row items-center">
              <TouchableOpacity onPress={() => router.back()} className="mr-3">
                <Ionicons name="chevron-back" size={28} color="#fff" />
              </TouchableOpacity>
              <AvatarImage source={null} name={chatName} size={40} />
              <View className="ml-3 flex-1">
                <Text className="text-lg font-semibold text-white">{chatName}</Text>
                <View className="flex-row items-center">
                  {isConnecting ? (
                    <Text className="text-xs text-gray-400">Connecting...</Text>
                  ) : isConnected ? (
                    <>
                      <View className="mr-1 h-2 w-2 rounded-full bg-green-500" />
                      <Text className="text-xs text-gray-400">
                        {isGroup ? 'Group Chat' : 'Active now'}
                      </Text>
                    </>
                  ) : (
                    <>
                      <View className="mr-1 h-2 w-2 rounded-full bg-red-500" />
                      <Text className="text-xs text-red-400">Disconnected</Text>
                    </>
                  )}
                </View>
              </View>
            </View>

            {/* Video Call Button */}
            <TouchableOpacity
              onPress={handleVideoCall}
              disabled={isStartingCall || isInCall}
              className="ml-1 rounded-full p-2"
              style={{ opacity: isStartingCall || isInCall ? 0.4 : 1 }}>
              <Ionicons name="videocam" size={22} color={isInCall ? '#f87171' : '#4A9EFF'} />
            </TouchableOpacity>

            {/* Voice Call Button */}
            <TouchableOpacity
              onPress={handleVoiceCall}
              disabled={isStartingCall || isInCall}
              className="ml-1 rounded-full p-2"
              style={{ opacity: isStartingCall || isInCall ? 0.4 : 1 }}>
              <Ionicons name="call" size={22} color={isInCall ? '#f87171' : '#4A9EFF'} />
            </TouchableOpacity>
          </View>

          {/* Messages */}
          {isLoadingMessages ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#4A9EFF" />
              <Text className="mt-4 text-gray-400">Loading messages...</Text>
            </View>
          ) : messages.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Ionicons name="chatbubble-outline" size={64} color="#666" />
              <Text className="mt-4 text-lg font-semibold text-gray-400">No messages yet</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                Start the conversation by sending a message
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingTop: 16, paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={true}
              onContentSizeChange={() => {
                if (!highlightMessage || highlightMessage !== 'true') {
                  flatListRef.current?.scrollToEnd({ animated: false });
                }
              }}
              onEndReached={loadMoreMessages}
              onScrollToIndexFailed={(info) => {
                const wait = new Promise((resolve) => setTimeout(resolve, 500));
                wait.then(() => {
                  flatListRef.current?.scrollToIndex({
                    index: info.index,
                    animated: true,
                    viewPosition: 0.5,
                  });
                });
              }}
              onEndReachedThreshold={0.5}
              ListHeaderComponent={
                isLoadingMore ? (
                  <View className="py-4">
                    <ActivityIndicator size="small" color="#4A9EFF" />
                    <Text className="mt-2 text-center text-xs text-gray-400">
                      Loading older messages...
                    </Text>
                  </View>
                ) : null
              }
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor="#4A9EFF"
                  colors={['#4A9EFF']}
                />
              }
            />
          )}

          {/* Input Bar */}
          <View className="border-t border-gray-800 bg-black px-4 py-3">
            {/* Edit Mode Indicator */}
            {editingMessageId && (
              <View className="mb-2 flex-row items-center justify-between rounded-lg bg-gray-900 px-3 py-2">
                <View className="flex-1 flex-row items-center">
                  <Entypo name="edit" size={16} color="#4A9EFF" />
                  <Text className="ml-2 text-sm text-gray-400">Editing message</Text>
                </View>
                <TouchableOpacity onPress={handleCancelEdit}>
                  <Ionicons name="close" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            <View className="flex-row items-center">
              {/* Input Field */}
              <View className="mr-2 flex-1 flex-row items-center rounded-lg bg-gray-800 px-4">
                <TextInput
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Write Something"
                  placeholderTextColor="#666"
                  className="max-h-[100px] flex-1 py-2 text-base text-white"
                  multiline
                  maxLength={100}
                />
                <TouchableOpacity className="" onPress={() => setIsOpen(true)}>
                  <MaterialCommunityIcons name="sticker-emoji" size={24} color="#4A9EFF" />
                </TouchableOpacity>
              </View>

              {/* Send Button */}
              <Pressable
                onPress={handleSend}
                className={`h-10 w-10 items-center justify-center rounded-full ${
                  inputText.trim() ? 'bg-blue-600' : 'bg-gray-700'
                }`}
                disabled={!inputText.trim()}>
                <Ionicons name={editingMessageId ? 'checkmark' : 'send'} size={20} color="#fff" />
              </Pressable>
            </View>

            {/* Emoji Picker Modal */}
            <EmojiPicker
              onEmojiSelected={handlePick}
              open={isOpen}
              onClose={() => setIsOpen(false)}
            />
          </View>
        </ImageBackground>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
