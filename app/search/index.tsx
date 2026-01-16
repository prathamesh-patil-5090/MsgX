import { Ionicons } from '@expo/vector-icons';
import AvatarImage from 'components/AvatarImage';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withAuthErrorHandling } from 'services/authUtils';
import { createConversation } from 'services/conversationsApi';
import { getAllUsers, searchUsers } from 'services/userApi';
import '../../global.css';

interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

type ViewMode = 'browse' | 'search';

export default function SearchUsersScreen() {
  const router = useRouter();

  // Search and users state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAllUsers, setLoadingAllUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection and group creation state
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingChat, setCreatingChat] = useState<number | null>(null);

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load all users on mount
  useEffect(() => {
    loadAllUsers();
  }, []);

  const loadAllUsers = async () => {
    setLoadingAllUsers(true);
    setError(null);

    const result = await withAuthErrorHandling(async () => {
      const response = await getAllUsers();
      return response;
    });

    if (result) {
      setAllUsers(result.users);
    } else {
      setError('Failed to load users.');
    }

    setLoadingAllUsers(false);
  };

  const performSearch = async (query: string) => {
    setLoading(true);
    setError(null);

    const result = await withAuthErrorHandling(async () => {
      const response = await searchUsers(query.trim());
      return response;
    });

    if (result) {
      setSearchResults(result.users);
      if (result.users.length === 0) {
        setError(null); // Will show "No Users Found" state
      }
    } else {
      setError('Failed to search users. Please try again.');
    }

    setLoading(false);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim().length === 0) {
      setSearchResults([]);
      setError(null);
      setLoading(false);
      setViewMode('browse');
      return;
    }

    // Switch to search mode
    setViewMode('search');
    setLoading(true);

    // Debounce search - wait 500ms after user stops typing
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 500);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleUserPress = async (user: User) => {
    // If no users selected, create DM immediately
    if (selectedUsers.length === 0) {
      setCreatingChat(user.id);
      console.log('Creating DM conversation with user:', user);

      const result = await withAuthErrorHandling(async () => {
        const conversation = await createConversation(false, [user.id]);
        return conversation;
      });

      if (result) {
        console.log('Conversation created:', result);
        router.push({
          pathname: '/chat/[id]',
          params: {
            id: result.id.toString(),
            name: `${user.first_name} ${user.last_name}`,
            type: 'dm',
          },
        });
      } else {
        Alert.alert('Error', 'Failed to create conversation. Please try again.');
      }

      setCreatingChat(null);
    }
  };

  const handleUserLongPress = (user: User) => {
    const isSelected = selectedUsers.some((u) => u.id === user.id);

    if (isSelected) {
      // Remove from selection
      setSelectedUsers((prev) => prev.filter((u) => u.id !== user.id));
    } else {
      // Add to selection
      setSelectedUsers((prev) => [...prev, user]);
    }
  };

  const handleCreateGroup = () => {
    if (selectedUsers.length < 2) {
      Alert.alert('Invalid Group', 'Please select at least 2 users to create a group.');
      return;
    }
    setShowGroupModal(true);
  };

  const handleGroupCreation = async () => {
    if (!groupName.trim()) {
      Alert.alert('Invalid Group Name', 'Please enter a group name.');
      return;
    }

    if (selectedUsers.length < 2) {
      Alert.alert('Invalid Group', 'Please select at least 2 users to create a group.');
      return;
    }

    setCreatingGroup(true);
    console.log(
      'Creating group:',
      groupName,
      'with users:',
      selectedUsers.map((u) => u.id)
    );

    const result = await withAuthErrorHandling(async () => {
      const conversation = await createConversation(
        true,
        selectedUsers.map((u) => u.id),
        groupName.trim()
      );
      return conversation;
    });

    if (result) {
      console.log('Group created:', result);
      setShowGroupModal(false);

      router.push({
        pathname: '/chat/[id]',
        params: {
          id: result.id.toString(),
          name: groupName.trim(),
          type: 'group',
        },
      });
    } else {
      Alert.alert('Error', 'Failed to create group. Please try again.');
    }

    setCreatingGroup(false);
  };

  const handleBack = () => {
    router.back();
  };

  const clearSelection = () => {
    setSelectedUsers([]);
  };

  const renderUserItem = ({ item }: { item: User }) => {
    const isCreating = creatingChat === item.id;
    const isSelected = selectedUsers.some((u) => u.id === item.id);
    const hasSelection = selectedUsers.length > 0;

    return (
      <Pressable
        onPress={() => !isCreating && handleUserPress(item)}
        onLongPress={() => !isCreating && handleUserLongPress(item)}
        disabled={isCreating}
        className={`flex-row items-center border-b border-gray-800 px-4 py-4 ${
          isSelected ? 'bg-blue-900' : 'bg-black'
        }`}
        style={{ opacity: isCreating ? 0.6 : 1 }}>
        <View className="relative">
          <AvatarImage source={null} name={`${item.first_name} ${item.last_name}`} size={48} />
          {isSelected && (
            <View className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-blue-600">
              <Ionicons name="checkmark" size={16} color="white" />
            </View>
          )}
        </View>

        <View className="ml-3 flex-1">
          <Text className="text-base font-semibold text-white">
            {item.first_name} {item.last_name}
          </Text>
          <Text className="mt-1 text-sm text-gray-400">@{item.username}</Text>
        </View>

        {isCreating ? (
          <ActivityIndicator size="small" color="#4A9EFF" />
        ) : hasSelection ? (
          <Text className="text-xs text-gray-500">Long press to select</Text>
        ) : (
          <Ionicons name="chevron-forward" size={20} color="#666666" />
        )}
      </Pressable>
    );
  };

  const renderSelectedUser = (user: User) => (
    <View key={user.id} className="mx-1 mb-2 items-center">
      <View className="relative">
        <AvatarImage source={null} name={`${user.first_name} ${user.last_name}`} size={40} />
        <TouchableOpacity
          onPress={() => handleUserLongPress(user)}
          className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-red-600">
          <Ionicons name="close" size={12} color="white" />
        </TouchableOpacity>
      </View>
      <Text
        className="mt-1 text-xs text-white"
        numberOfLines={1}
        style={{ width: 50, textAlign: 'center' }}>
        {user.first_name}
      </Text>
    </View>
  );

  const currentUsers = viewMode === 'search' ? searchResults : allUsers;
  const isLoadingUsers = viewMode === 'search' ? loading : loadingAllUsers;

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center border-b border-gray-800 px-4 py-3">
        <TouchableOpacity onPress={handleBack} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="flex-1 text-xl font-semibold text-white">
          {selectedUsers.length > 0 ? 'Create Group' : 'New Chat'}
        </Text>
        {selectedUsers.length > 0 && (
          <TouchableOpacity onPress={clearSelection} className="ml-2">
            <Text className="text-blue-500">Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search Input */}
      <View className="border-b border-gray-800 bg-black px-4 py-3">
        <View className="flex-row items-center rounded-lg bg-gray-900 px-3 py-2">
          <Ionicons name="search" size={20} color="#666666" style={{ marginRight: 8 }} />
          <TextInput
            style={{
              flex: 1,
              color: '#ffffff',
              fontSize: 16,
              paddingVertical: 8,
            }}
            placeholder="Search by username or name..."
            placeholderTextColor="#666666"
            value={searchQuery}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch('')} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={20} color="#666666" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Selected Users */}
      {selectedUsers.length > 0 && (
        <View className="border-b border-gray-800 bg-gray-900 px-4 py-3">
          <Text className="mb-2 text-sm text-gray-400">Selected ({selectedUsers.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row">{selectedUsers.map(renderSelectedUser)}</View>
          </ScrollView>
          {selectedUsers.length >= 2 && (
            <TouchableOpacity
              onPress={handleCreateGroup}
              className="mt-3 items-center rounded-lg bg-blue-600 py-3">
              <Text className="font-semibold text-white">
                Create Group with {selectedUsers.length} members
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content */}
      <View className="flex-1">
        {isLoadingUsers ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#4A9EFF" />
            <Text className="mt-4 text-gray-400">
              {viewMode === 'search' ? 'Searching...' : 'Loading users...'}
            </Text>
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="alert-circle-outline" size={64} color="#666666" />
            <Text className="mt-4 text-center text-gray-400">{error}</Text>
            <TouchableOpacity
              onPress={viewMode === 'search' ? () => performSearch(searchQuery) : loadAllUsers}
              className="mt-4 rounded-lg bg-blue-600 px-6 py-3">
              <Text className="text-white">Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : viewMode === 'search' && searchQuery.trim().length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="search-outline" size={64} color="#666666" />
            <Text className="mt-4 text-center text-lg font-semibold text-white">
              Search for Users
            </Text>
            <Text className="mt-2 text-center text-gray-400">
              Enter a username or name to find people
            </Text>
          </View>
        ) : currentUsers.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="person-outline" size={64} color="#666666" />
            <Text className="mt-4 text-center text-lg font-semibold text-white">
              No Users Found
            </Text>
            <Text className="mt-2 text-center text-gray-400">
              {viewMode === 'search'
                ? 'Try searching with a different username or name'
                : 'No users available on the platform'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={currentUsers}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderUserItem}
            contentContainerStyle={{ paddingBottom: 20 }}
          />
        )}
      </View>

      {/* Info Footer */}
      {currentUsers.length > 0 && !isLoadingUsers && (
        <View className="border-t border-gray-800 bg-gray-900 px-4 py-3">
          <Text className="text-center text-xs text-gray-500">
            {selectedUsers.length > 0
              ? 'Tap to remove • Long press to add more users'
              : 'Tap for DM • Long press to select for group'}
          </Text>
        </View>
      )}

      {/* Group Creation Modal */}
      <Modal
        visible={showGroupModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGroupModal(false)}>
        <View className="flex-1 justify-end bg-black/50">
          <View className="rounded-t-3xl bg-gray-900 px-6 py-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-xl font-semibold text-white">Create Group</Text>
              <TouchableOpacity onPress={() => setShowGroupModal(false)}>
                <Ionicons name="close" size={24} color="#666666" />
              </TouchableOpacity>
            </View>

            <Text className="mb-2 text-sm text-gray-400">Group Name</Text>
            <TextInput
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
                padding: 12,
                color: '#ffffff',
                fontSize: 16,
                marginBottom: 16,
              }}
              placeholder="Enter group name..."
              placeholderTextColor="#666666"
              value={groupName}
              onChangeText={setGroupName}
              autoFocus
            />

            <Text className="mb-3 text-sm text-gray-400">Members ({selectedUsers.length})</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-6">
              <View className="flex-row">{selectedUsers.map(renderSelectedUser)}</View>
            </ScrollView>

            <TouchableOpacity
              onPress={handleGroupCreation}
              disabled={creatingGroup || !groupName.trim()}
              className={`items-center rounded-lg py-4 ${
                creatingGroup || !groupName.trim() ? 'bg-gray-600' : 'bg-blue-600'
              }`}>
              {creatingGroup ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="font-semibold text-white">Create Group</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
