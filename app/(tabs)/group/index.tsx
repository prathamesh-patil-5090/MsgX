import { Ionicons } from '@expo/vector-icons';
import ChatHeader from 'components/ChatHeader';
import ConversationList, { Conversation } from 'components/ConversationList';
import EmptyState from 'components/EmptyState';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withAuthErrorHandling } from 'services/authUtils';
import { cacheConversations } from 'services/cacheService';
import {
  ConversationResponse,
  deleteConversation,
  fetchConversations,
} from 'services/conversationsApi';
import '../../../global.css';

// Helper function to format timestamp
const formatMessageTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) {
    // Today - show time
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } else if (diffInDays === 1) {
    return 'Yesterday';
  } else if (diffInDays < 7) {
    // Within a week - show day name
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    // Older - show date
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
};

// Convert API response to ConversationList format
const convertToConversationFormat = (apiConversation: ConversationResponse): Conversation => {
  return {
    id: apiConversation.id.toString(),
    name: apiConversation.display_name,
    profileImage: null, // You can add avatar URLs later
    lastMessage: apiConversation.latest_message?.content || 'No messages yet',
    sender: apiConversation.latest_message?.sender_name || '',
    messageTime: apiConversation.latest_message
      ? formatMessageTime(apiConversation.latest_message.created_at)
      : '',
    status: apiConversation.unread_count > 0 ? 'unread' : 'read',
    unreadCount: apiConversation.unread_count,
  };
};

export default function GroupScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const result = await withAuthErrorHandling(async () => {
      const response = await fetchConversations(true); // true = Groups only
      return response;
    });

    if (result) {
      const formattedConversations = result.results.map(convertToConversationFormat);
      setConversations(formattedConversations);

      // Cache conversations for search
      try {
        await cacheConversations(formattedConversations, 'group');
      } catch (cacheError) {
        console.error('Error caching conversations:', cacheError);
      }
    } else {
      setError('Failed to load conversations');
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Refresh conversations when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      console.log('[Group] Screen focused, refreshing conversations');
      loadConversations(true);
    }, [loadConversations])
  );

  const handleRefresh = () => {
    loadConversations(true);
  };

  const handleDeleteConversations = async (ids: string[]) => {
    const result = await withAuthErrorHandling(async () => {
      // Delete conversations from backend
      await Promise.all(ids.map((id) => deleteConversation(parseInt(id))));
    });

    if (result !== null) {
      // Update local state
      setConversations((prev) => prev.filter((c) => !ids.includes(c.id)));
    } else {
      setError('Failed to delete conversations');
    }
  };

  const handleConversationPress = (conversation: Conversation) => {
    // Optimistically update the unread count to 0 when opening a conversation
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === conversation.id ? { ...conv, unreadCount: 0, status: 'read' as const } : conv
      )
    );

    router.push({
      pathname: '/chat/[id]',
      params: {
        id: conversation.id,
        name: conversation.name,
        type: 'group',
      },
    });
  };

  const handleNewGroup = () => {
    router.push('/add');
  };

  // Loading state
  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
        <ChatHeader />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#4A9EFF" />
          <Text className="mt-4 text-gray-400">Loading groups...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
        <ChatHeader />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-2 text-lg font-semibold text-red-500">Error</Text>
          <Text className="mb-4 text-center text-gray-400">{error}</Text>
          <View className="rounded-full bg-blue-600 px-6 py-3">
            <Text className="font-semibold text-white" onPress={() => loadConversations()}>
              Try Again
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1">
          {/* Header with Search Bar and Profile Button */}
          <ChatHeader />

          {/* Show Empty State or Conversation List */}
          {conversations.length === 0 ? (
            <EmptyState
              title="No groups yet!"
              subtitle="Create or join a group to start messaging"
              iconName="account-group-outline"
            />
          ) : (
            <ConversationList
              conversations={conversations}
              onDeleteConversations={handleDeleteConversations}
              onConversationPress={handleConversationPress}
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
        </KeyboardAvoidingView>

        {/* Floating Action Button */}
        <TouchableOpacity
          onPress={handleNewGroup}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 20,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: '#4A9EFF',
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 8,
          }}
          activeOpacity={0.8}>
          <Ionicons name="add" size={28} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
