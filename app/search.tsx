import { Ionicons } from '@expo/vector-icons';
import AvatarImage from 'components/AvatarImage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, SectionList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { searchCache, type CachedConversation, type CachedMessage } from 'services/cacheService';

export default function SearchPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    conversations: CachedConversation[];
    messages: CachedMessage[];
  }>({ conversations: [], messages: [] });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Auto-focus the search input when the page loads
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    // Cleanup debounce timer on unmount
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);

    // If query is empty, cancel pending search and clear results
    if (query.trim().length === 0) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setSearchResults({ conversations: [], messages: [] });
      return;
    }

    // Debounce search to avoid firing on every keystroke
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchCache(query);
        setSearchResults(results);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setIsSearching(false);
        debounceRef.current = null;
      }
    }, 300);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults({ conversations: [], messages: [] });
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const handleConversationPress = (conversation: CachedConversation) => {
    router.push({
      pathname: '/chat/[id]',
      params: {
        id: conversation.id,
        name: conversation.name,
        type: conversation.type,
      },
    });
  };

  const handleMessagePress = (message: CachedMessage) => {
    router.push({
      pathname: '/chat/[id]',
      params: {
        id: message.conversationId,
        name: message.conversationName,
        type: message.type,
        messageId: message.id,
        highlightMessage: 'true',
      },
    });
  };

  const renderConversationResult = ({ item }: { item: CachedConversation }) => (
    <Pressable
      onPress={() => handleConversationPress(item)}
      className="flex-row items-center border-b border-gray-800 bg-black px-4 py-3">
      <AvatarImage source={null} name={item.name} size={48} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-white" numberOfLines={1}>
            {item.name}
          </Text>
          <View className="ml-2 rounded-full bg-gray-700 px-2 py-1">
            <Text className="text-xs text-gray-300">{item.type === 'dm' ? 'DM' : 'Group'}</Text>
          </View>
        </View>
        <Text className="mt-1 text-sm text-gray-400" numberOfLines={1}>
          {item.lastMessage}
        </Text>
      </View>
    </Pressable>
  );

  const renderMessageResult = ({ item }: { item: CachedMessage }) => (
    <Pressable
      onPress={() => handleMessagePress(item)}
      className="flex-row items-center border-b border-gray-800 bg-black px-4 py-3">
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-gray-700">
        <Ionicons name="chatbubble-outline" size={20} color="#4A9EFF" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-white" numberOfLines={1}>
            {item.conversationName}
          </Text>
          <Text className="ml-2 text-xs text-gray-500">{item.timestamp}</Text>
        </View>
        <Text className="mt-1 text-xs text-gray-400" numberOfLines={1}>
          {item.senderName}: {item.content}
        </Text>
      </View>
    </Pressable>
  );

  const hasResults = searchResults.conversations.length > 0 || searchResults.messages.length > 0;
  const hasSearched = searchQuery.trim().length > 0;

  type SearchSection = { title: string; data: (CachedConversation | CachedMessage)[] };
  const sections: SearchSection[] = [
    ...(searchResults.conversations.length > 0
      ? [
          {
            title: 'CONVERSATIONS',
            data: searchResults.conversations as (CachedConversation | CachedMessage)[],
          },
        ]
      : []),
    ...(searchResults.messages.length > 0
      ? [
          {
            title: 'MESSAGES',
            data: searchResults.messages as (CachedConversation | CachedMessage)[],
          },
        ]
      : []),
  ];

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      {/* Header with Back Button and Search Input */}
      <View className="border-b border-gray-800 bg-black pb-2">
        <View className="flex-row items-center px-4 pt-2">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View className="flex-1 flex-row items-center rounded-lg bg-gray-900 px-3 py-2">
            <Ionicons name="search" size={20} color="#666666" style={{ marginRight: 8 }} />
            <TextInput
              ref={inputRef}
              style={{
                flex: 1,
                color: '#ffffff',
                fontSize: 16,
                paddingVertical: 4,
              }}
              placeholder="Search messages and conversations..."
              placeholderTextColor="#666666"
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleClearSearch} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={20} color="#666666" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Search Results */}
      <View className="flex-1">
        {!hasSearched ? (
          // Initial state - show search prompt
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search-outline" size={64} color="#666" />
            <Text className="mt-4 text-center text-lg text-gray-400">
              Search for messages and conversations
            </Text>
            <Text className="mt-2 text-center text-sm text-gray-500">
              Type in the search box above to get started
            </Text>
          </View>
        ) : isSearching ? (
          // Loading state
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-400">Searching...</Text>
          </View>
        ) : hasResults ? (
          // Results list
          <SectionList
            sections={sections}
            keyExtractor={(item: CachedConversation | CachedMessage, index) =>
              `${item.id}-${index}`
            }
            renderItem={({ item }) => {
              if ('name' in item) {
                return renderConversationResult({ item: item as CachedConversation });
              } else {
                return renderMessageResult({ item: item as CachedMessage });
              }
            }}
            renderSectionHeader={({ section: { title } }) => (
              <View className="border-b border-gray-800 bg-gray-900 px-4 py-2">
                <Text className="text-xs font-semibold text-gray-400">{title}</Text>
              </View>
            )}
            stickySectionHeadersEnabled
            keyboardShouldPersistTaps="handled"
          />
        ) : (
          // No results state
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search-outline" size={64} color="#666" />
            <Text className="mt-4 text-center text-lg text-gray-400">No results found</Text>
            <Text className="mt-2 text-center text-sm text-gray-500">
              Try searching for something else
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
