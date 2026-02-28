import AsyncStorage from '@react-native-async-storage/async-storage';
import { Conversation } from 'components/ConversationList';

const CONVERSATIONS_CACHE_KEY = 'conversations_cache';
const MESSAGES_CACHE_KEY = 'messages_search_cache';

export interface CachedConversation extends Conversation {
  type: 'dm' | 'group';
  participants?: string[];
}

export interface CachedMessage {
  id: string;
  conversationId: string;
  conversationName: string;
  content: string;
  senderId: number;
  senderName: string;
  timestamp: string;
  type: 'dm' | 'group';
}

export interface SearchResult {
  conversations: CachedConversation[];
  messages: CachedMessage[];
}

/**
 * Cache conversations for search
 */
export const cacheConversations = async (
  conversations: Conversation[],
  type: 'dm' | 'group'
): Promise<void> => {
  try {
    const existingCacheStr = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
    const existingCache: CachedConversation[] = existingCacheStr
      ? JSON.parse(existingCacheStr)
      : [];

    const filteredCache = existingCache.filter((c) => c.type !== type);

    const newConversations: CachedConversation[] = conversations.map((conv) => ({
      ...conv,
      type,
    }));

    const updatedCache = [...filteredCache, ...newConversations];

    await AsyncStorage.setItem(CONVERSATIONS_CACHE_KEY, JSON.stringify(updatedCache));
    console.log(`[cacheService] Cached ${newConversations.length} ${type} conversations`);
  } catch (error) {
    console.error('[cacheService] Error caching conversations:', error);
  }
};

/**
 * Cache messages for search
 */
export const cacheMessagesForSearch = async (
  conversationId: string,
  conversationName: string,
  messages: {
    id: string;
    content: string;
    senderId: number;
    senderName: string;
    timestamp: string;
  }[],
  type: 'dm' | 'group'
): Promise<void> => {
  try {
    const existingCacheStr = await AsyncStorage.getItem(MESSAGES_CACHE_KEY);
    const existingCache: CachedMessage[] = existingCacheStr ? JSON.parse(existingCacheStr) : [];

    const filteredCache = existingCache.filter((m) => m.conversationId !== conversationId);

    const newMessages: CachedMessage[] = messages.map((msg) => ({
      ...msg,
      conversationId,
      conversationName,
      type,
    }));

    const updatedCache = [...filteredCache, ...newMessages].slice(-1000);

    await AsyncStorage.setItem(MESSAGES_CACHE_KEY, JSON.stringify(updatedCache));
    console.log(
      `[cacheService] Cached ${newMessages.length} messages for conversation ${conversationId}`
    );
  } catch (error) {
    console.error('[cacheService] Error caching messages:', error);
  }
};

/**
 * Search cached data
 */
export const searchCache = async (query: string): Promise<SearchResult> => {
  try {
    if (!query.trim()) {
      return { conversations: [], messages: [] };
    }

    const lowerQuery = query.toLowerCase().trim();

    const conversationsCacheStr = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
    const conversationsCache: CachedConversation[] = conversationsCacheStr
      ? JSON.parse(conversationsCacheStr)
      : [];

    const messagesCacheStr = await AsyncStorage.getItem(MESSAGES_CACHE_KEY);
    const messagesCache: CachedMessage[] = messagesCacheStr ? JSON.parse(messagesCacheStr) : [];

    const matchedConversations = conversationsCache.filter((conv) => {
      const nameMatch = conv.name.toLowerCase().includes(lowerQuery);
      const messageMatch = conv.lastMessage.toLowerCase().includes(lowerQuery);
      const senderMatch = conv.sender?.toLowerCase().includes(lowerQuery);
      return nameMatch || messageMatch || senderMatch;
    });

    const matchedMessages = messagesCache.filter((msg) => {
      const contentMatch = msg.content.toLowerCase().includes(lowerQuery);
      const senderMatch = msg.senderName.toLowerCase().includes(lowerQuery);
      const conversationMatch = msg.conversationName.toLowerCase().includes(lowerQuery);
      return contentMatch || senderMatch || conversationMatch;
    });

    const sortedConversations = matchedConversations.sort((a, b) => {
      const aExact = a.name.toLowerCase() === lowerQuery;
      const bExact = b.name.toLowerCase() === lowerQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return 0;
    });

    console.log(`[cacheService] Search "${query}" found:`, {
      conversations: matchedConversations.length,
      messages: matchedMessages.length,
    });

    return {
      conversations: sortedConversations,
      messages: matchedMessages.slice(0, 50),
    };
  } catch (error) {
    console.error('[cacheService] Error searching cache:', error);
    return { conversations: [], messages: [] };
  }
};

/**
 * Clear all cache
 */
export const clearCache = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([CONVERSATIONS_CACHE_KEY, MESSAGES_CACHE_KEY]);
    console.log('[cacheService] Cache cleared');
  } catch (error) {
    console.error('[cacheService] Error clearing cache:', error);
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async (): Promise<{
  conversationsCount: number;
  messagesCount: number;
}> => {
  try {
    const conversationsCacheStr = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
    const messagesCacheStr = await AsyncStorage.getItem(MESSAGES_CACHE_KEY);

    const conversationsCount = conversationsCacheStr ? JSON.parse(conversationsCacheStr).length : 0;
    const messagesCount = messagesCacheStr ? JSON.parse(messagesCacheStr).length : 0;

    return { conversationsCount, messagesCount };
  } catch (error) {
    console.error('[cacheService] Error getting cache stats:', error);
    return { conversationsCount: 0, messagesCount: 0 };
  }
};
