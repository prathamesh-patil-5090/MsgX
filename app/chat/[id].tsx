import { Entypo, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AvatarImage from 'components/AvatarImage';
import OptionsModal from 'components/OptionsModal';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { getAccessToken, getUserId } from 'services/loginApi';
import {
  deleteMessage,
  fetchMessages,
  markMessageAsRead,
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
    // Ensure it's a number
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
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const currentUserIdRef = useRef<number | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastReadMessageId, setLastReadMessageId] = useState<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const getCacheKey = (conversationId: string) => `messages_${conversationId}`;

  const loadCachedMessages = async (conversationId: string, userId: number) => {
    try {
      const cacheKey = getCacheKey(conversationId);
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        console.log(`Loaded ${cachedData.messages.length} cached messages`);
        setMessages(cachedData.messages);
        setNextPage(cachedData.nextPage);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading cached messages:', error);
      return false;
    }
  };

  const cacheMessages = async (
    conversationId: string,
    messages: Message[],
    nextPage: string | null
  ) => {
    try {
      const cacheKey = getCacheKey(conversationId);
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({
          messages,
          nextPage,
          timestamp: new Date().toISOString(),
        })
      );
      console.log('Messages cached successfully');
    } catch (error) {
      console.error('Error caching messages:', error);
    }
  };

  const loadMessages = async (conversationId: string, userId: number, showRefreshing = false) => {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setIsLoadingMessages(true);
      }

      console.log('Fetching messages for conversation:', conversationId);
      const response = await fetchMessages(parseInt(conversationId));
      console.log('API Response type:', typeof response);
      console.log('API Response keys:', response ? Object.keys(response) : 'null/undefined');
      console.log('Response.results:', response?.results);
      console.log('Is results an array?', Array.isArray(response?.results));

      if (!response || !response.results || !Array.isArray(response.results)) {
        console.error('Invalid or empty response:', response);
        setMessages([]);
        setIsLoadingMessages(false);
        setRefreshing(false);
        return;
      }

      const uiMessages = response.results
        .map((msg) => convertApiMessageToUIMessage(msg, userId))
        .reverse(); // Reverse so newest messages are at the bottom

      setMessages(uiMessages);
      setNextPage(response.next);

      await cacheMessages(conversationId, uiMessages, response.next);

      const searchCacheMessages = uiMessages.map((msg) => ({
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

      console.log(`Loaded ${uiMessages.length} messages for conversation ${conversationId}`);
      return uiMessages;
    } catch (error) {
      console.error('Error loading messages:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load messages';

      if (!showRefreshing) {
        Alert.alert('Error', errorMessage + '\n\nPlease check your connection and try again.');
      } else {
        console.log('Failed to refresh messages:', errorMessage);
      }
    } finally {
      setIsLoadingMessages(false);
      setRefreshing(false);
    }
    return [];
  };

  const loadMoreMessages = async () => {
    if (!nextPage || isLoadingMore || !currentUserId || !id) return;

    try {
      setIsLoadingMore(true);
      console.log('Loading more messages from:', nextPage);

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
        const newMessages = data.results.messages
          .map((msg: MessageResponse) => convertApiMessageToUIMessage(msg, currentUserId))
          .reverse();

        const updatedMessages = [...newMessages, ...messages];
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

        console.log(`Loaded ${newMessages.length} more messages`);
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

      try {
        let userIdStr = await getUserId();
        let userId: number | null = null;

        if (userIdStr) {
          userId = parseInt(userIdStr);
        } else {
          console.log('User ID not in storage, decoding from token...');
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

        const hasCached = await loadCachedMessages(conversationId, userId);

        let loadedMessages: Message[] = [];
        if (hasCached) {
          setIsLoadingMessages(false);
          loadedMessages = (await loadMessages(conversationId, userId)) || [];
        } else {
          loadedMessages = (await loadMessages(conversationId, userId)) || [];
        }

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
          // Normal scroll to bottom
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }, 100);
        }

        // Mark latest message as read
        if (loadedMessages.length > 0) {
          const latestMessage = loadedMessages[loadedMessages.length - 1];
          if (latestMessage.sender === 'other' && latestMessage.id) {
            const messageId = parseInt(latestMessage.id);
            try {
              await markMessageAsRead(parseInt(conversationId), messageId);
              setLastReadMessageId(messageId);
              console.log(`Marked message ${messageId} as read`);
            } catch (error) {
              console.error('Error marking message as read:', error);
              // Don't show alert for this, it's not critical
            }
          }
        }
      } catch (error) {
        console.error('Error initializing chat:', error);
        Alert.alert('Error', 'Failed to initialize chat. Please try again.');
      }
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // WebSocket connection effect
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

    // Wait a bit for messages to load before connecting WebSocket
    const timer = setTimeout(() => {
      connectWebSocket();
    }, 500);

    // Set up message handler
    const unsubscribeMessage = websocketService.onMessage((data: WebSocketResponse) => {
      console.log('Received message from WebSocket:', data);
      const currentUserIdValue = currentUserIdRef.current;
      console.log('Current user ID:', currentUserIdValue);
      console.log('Message sender ID:', data.sender_id);
      console.log('Sender ID type:', typeof data.sender_id);
      console.log('Current user ID type:', typeof currentUserIdValue);

      // Use functional update to avoid dependency on messages
      setMessages((prev) => {
        // This is a new message from another user
        // Ensure type consistency for comparison
        const senderId = parseInt(data.sender_id.toString());
        const currentUserIdNum =
          currentUserIdValue !== null ? parseInt(currentUserIdValue.toString()) : null;
        const isFromMe = currentUserIdNum !== null && senderId === currentUserIdNum;
        console.log('Is message from me?', isFromMe);
        console.log('Comparison:', senderId, '===', currentUserIdNum);

        const newMessage: Message = {
          id: data.temp_id,
          text: data.message,
          sender: isFromMe ? 'me' : 'other',
          sender_id: data.sender_id,
          timestamp: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          temp_id: data.temp_id,
        };

        console.log('New message created with sender:', newMessage.sender);

        // Scroll to bottom after adding message
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }, 50);

        const updatedMessages = [...prev, newMessage];

        // Mark as read if it's from another user
        if (!isFromMe && id) {
          const conversationId = Array.isArray(id) ? id[0] : id;
          const messageId = parseInt(newMessage.id);
          markMessageAsRead(parseInt(conversationId), messageId)
            .then(() => {
              setLastReadMessageId(messageId);
            })
            .catch((error) => {
              console.error('Error marking message as read:', error);
            });

          // Cache new message for search
          cacheMessagesForSearch(
            conversationId,
            chatName,
            [
              {
                id: newMessage.id,
                content: newMessage.text,
                senderId: newMessage.sender_id || 0,
                senderName: newMessage.sender_name || chatName,
                timestamp: newMessage.timestamp,
              },
            ],
            isGroup ? 'group' : 'dm'
          ).catch((error) => {
            console.error('Error caching message for search:', error);
          });
        }

        return updatedMessages;
      });
    });

    // Set up connection status handlers
    const unsubscribeOpen = websocketService.onOpen(() => {
      setIsConnected(true);
      setIsConnecting(false);
      console.log('WebSocket connection opened');
    });

    const unsubscribeClose = websocketService.onClose(() => {
      setIsConnected(false);
      console.log('WebSocket connection closed');
    });

    const unsubscribeError = websocketService.onError((error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    });

    // Cleanup on unmount
    return () => {
      clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeOpen();
      unsubscribeClose();
      unsubscribeError();
      websocketService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setSelectedMessageId(null); // Close options modal
    }
  };

  // Handle delete message - show confirmation alert
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

              setMessages((prev) => prev.filter((m) => m.id !== messageId));
              setSelectedMessageId(null);

              const searchCacheMessages = messages
                .filter(
                  (m) =>
                    m.id !== messageId && m.sender_id !== undefined && m.sender_name !== undefined
                )
                .map((msg) => ({
                  id: msg.id,
                  content: msg.text,
                  senderId: msg.sender_id!,
                  senderName: msg.sender_name!,
                  timestamp: msg.timestamp,
                }));
              await cacheMessagesForSearch(
                id as string,
                chatName,
                searchCacheMessages,
                isGroup ? 'group' : 'dm'
              );
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

  // Cancel editing
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
      // If editing, update the existing message
      if (editingMessageId) {
        const messageText = inputText.trim();
        try {
          // Call update API
          const updatedMessage = await updateMessage(
            Number(id),
            Number(editingMessageId),
            messageText
          );

          // Update message in UI
          setMessages((prev) =>
            prev.map((msg) =>
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
            )
          );

          setEditingMessageId(null);
          setInputText('');

          // Update cache
          const searchCacheMessages = messages
            .filter((msg) => msg.sender_id !== undefined && msg.sender_name !== undefined)
            .map((msg) =>
              msg.id === editingMessageId
                ? {
                    id: msg.id,
                    content: updatedMessage.content,
                    senderId: msg.sender_id!,
                    senderName: msg.sender_name!,
                    timestamp: new Date(updatedMessage.updated_at).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    }),
                  }
                : {
                    id: msg.id,
                    content: msg.text,
                    senderId: msg.sender_id!,
                    senderName: msg.sender_name!,
                    timestamp: msg.timestamp,
                  }
            );
          await cacheMessagesForSearch(
            id as string,
            chatName,
            searchCacheMessages,
            isGroup ? 'group' : 'dm'
          );
        } catch (error) {
          console.error('Error updating message:', error);
          Alert.alert('Update Failed', 'Could not update message. Please try again.');
        }
        return;
      }

      // Check if WebSocket is connected
      if (!websocketService.isConnected()) {
        Alert.alert('Not Connected', 'Unable to send message. Please check your connection.');
        return;
      }

      const messageText = inputText.trim();

      // Send via WebSocket first
      try {
        websocketService.sendMessage(messageText);
        setInputText('');
      } catch (error) {
        console.error('Error sending message:', error);
        Alert.alert('Send Failed', 'Could not send message. Please try again.');
      }
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender === 'me';
    const isOptionsOpen = selectedMessageId === item.id;
    const displayName = isMe ? 'You' : item.sender_name || chatName;

    // Determine if message is read (compare with last read message ID)
    const messageIdNum = parseInt(item.id);
    const isRead = lastReadMessageId !== null && messageIdNum <= lastReadMessageId;

    // Check if this message is highlighted
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
                  onEdit={handleEditMessage}
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
                // Double tick (read)
                <Ionicons name="checkmark-done" size={14} color="#4A9EFF" />
              ) : (
                // Single tick (sent)
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
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
                // Only auto-scroll if not highlighting a message
                if (!highlightMessage || highlightMessage !== 'true') {
                  flatListRef.current?.scrollToEnd({ animated: false });
                }
              }}
              onEndReached={loadMoreMessages}
              onScrollToIndexFailed={(info) => {
                // Handle scroll to index failure
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
                  inputText.trim() && isConnected ? 'bg-blue-600' : 'bg-gray-700'
                }`}
                disabled={!inputText.trim() || !isConnected}>
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
