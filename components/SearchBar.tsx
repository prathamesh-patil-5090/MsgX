import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { searchCache, type CachedConversation, type CachedMessage } from 'services/cacheService';
import AvatarImage from './AvatarImage';

interface SearchBarProps {
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
}

export default function SearchBar({ onSearchFocus, onSearchBlur }: SearchBarProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    conversations: CachedConversation[];
    messages: CachedMessage[];
  }>({ conversations: [], messages: [] });
  const [showResults, setShowResults] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);

    if (query.trim().length === 0) {
      setSearchResults({ conversations: [], messages: [] });
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchCache(query);
      setSearchResults(results);
      setShowResults(true);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults({ conversations: [], messages: [] });
    setShowResults(false);
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
    handleClearSearch();
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
    handleClearSearch();
  };

  const handleFocus = () => {
    onSearchFocus?.();
  };

  const handleBlur = () => {
    // Delay to allow pressing on results
    setTimeout(() => {
      onSearchBlur?.();
    }, 200);
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

  return (
    <>
      <View className="relative z-50">
        {/* Search Input */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#1a1a1a',
            borderRadius: 10,
            marginHorizontal: 16,
            marginTop: 16,
            marginBottom: 16,
            paddingHorizontal: 12,
            height: 45,
          }}>
          <Ionicons name="search" size={20} color="#666666" style={{ marginRight: 8 }} />
          <TextInput
            style={{
              flex: 1,
              color: '#ffffff',
              fontSize: 16,
              paddingVertical: 8,
            }}
            placeholder="Search messages..."
            placeholderTextColor="#666666"
            value={searchQuery}
            onChangeText={handleSearch}
            onFocus={handleFocus}
            onBlur={handleBlur}
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

      {/* Search Results Overlay */}
      {showResults && searchQuery.trim().length > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}>
          {/* Backdrop - tap to close */}
          <Pressable style={{ flex: 1 }} onPress={handleClearSearch} />

          {/* Results Container */}
          <View
            style={{
              position: 'absolute',
              top: 77,
              left: 16,
              right: 16,
              maxHeight: '80%',
              backgroundColor: '#1a1a1a',
              borderRadius: 10,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 8,
            }}>
            {isSearching ? (
              <View className="items-center justify-center py-8">
                <Text className="text-gray-400">Searching...</Text>
              </View>
            ) : hasResults ? (
              <FlatList
                data={[
                  ...searchResults.conversations.map((c) => ({ type: 'conversation', data: c })),
                  ...searchResults.messages.map((m) => ({ type: 'message', data: m })),
                ]}
                keyExtractor={(item, index) =>
                  item.type === 'conversation'
                    ? `conv-${(item.data as CachedConversation).id}`
                    : `msg-${(item.data as CachedMessage).id}-${index}`
                }
                renderItem={({ item }) => {
                  if (item.type === 'conversation') {
                    return renderConversationResult({ item: item.data as CachedConversation });
                  } else {
                    return renderMessageResult({ item: item.data as CachedMessage });
                  }
                }}
                ListHeaderComponent={
                  <View className="border-b border-gray-800 bg-gray-800 px-4 py-2">
                    <Text className="text-xs font-semibold text-gray-400">
                      {searchResults.conversations.length > 0 && 'CONVERSATIONS'}
                    </Text>
                  </View>
                }
                ListEmptyComponent={
                  <View className="items-center justify-center py-8">
                    <Ionicons name="search-outline" size={48} color="#666" />
                    <Text className="mt-2 text-gray-400">No results found</Text>
                  </View>
                }
                nestedScrollEnabled
                style={{ maxHeight: 500 }}
              />
            ) : (
              <View className="items-center justify-center py-8">
                <Ionicons name="search-outline" size={48} color="#666" />
                <Text className="mt-2 text-gray-400">No results found</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </>
  );
}
