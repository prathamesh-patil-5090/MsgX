import { Entypo, MaterialIcons } from '@expo/vector-icons';
import AvatarImage from 'components/AvatarImage';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  ImageSourcePropType,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export interface Conversation {
  id: string;
  name: string;
  profileImage?: ImageSourcePropType | null;
  lastMessage: string;
  sender: string;
  messageTime: string;
  status: 'read' | 'unread';
  unreadCount?: number;
}

interface ConversationListProps {
  conversations: Conversation[];
  onDeleteConversations: (ids: string[]) => void;
  onConversationPress?: (conversation: Conversation) => void;
  refreshControl?: React.ReactElement;
}

const AnimatedConversationItem = ({
  item,
  isSelected,
  onLongPress,
  onPress,
}: {
  item: Conversation;
  isSelected: boolean;
  onLongPress: () => void;
  onPress: () => void;
}) => {
  // Animated values
  const scale = useSharedValue(1);
  const checkScale = useSharedValue(0);
  const checkOpacity = useSharedValue(0);
  const borderOpacity = useSharedValue(1);
  const backgroundColor = useSharedValue(0);

  // Update animations when selection changes
  React.useEffect(() => {
    if (isSelected) {
      scale.value = withSpring(0.98, { damping: 15, stiffness: 150 });
      checkScale.value = withSpring(1, { damping: 12, stiffness: 200 });
      checkOpacity.value = withTiming(1, { duration: 200 });
      borderOpacity.value = withTiming(0, { duration: 150 });
      backgroundColor.value = withTiming(1, { duration: 200 });
    } else {
      scale.value = withSpring(1, { damping: 15, stiffness: 150 });
      checkScale.value = withTiming(0, { duration: 150 });
      checkOpacity.value = withTiming(0, { duration: 150 });
      borderOpacity.value = withTiming(1, { duration: 200 });
      backgroundColor.value = withTiming(0, { duration: 200 });
    }
  }, [isSelected]);

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: `rgba(29, 185, 84, ${backgroundColor.value * 0.1})`,
  }));

  const animatedCheckStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkOpacity.value,
  }));

  const animatedBorderStyle = useAnimatedStyle(() => ({
    opacity: borderOpacity.value,
  }));

  return (
    <Pressable onLongPress={onLongPress} onPress={onPress}>
      <Animated.View style={animatedContainerStyle} className="px-4 py-4">
        <View className="flex-row items-center">
          {/* Profile Image */}
          <AvatarImage source={item.profileImage} name={item.name} size={64} />

          {/* Content */}
          <View className="flex-1 pl-4 pr-3">
            <Text className="text-lg font-semibold text-white">{item.name}</Text>
            <View className="mt-1 flex-row items-center">
              <Text numberOfLines={1} ellipsizeMode="tail" className="text-md flex text-gray-400">
                {item.lastMessage}
              </Text>
              <Entypo name="dot-single" color={'#9b9b9b'} size={12} />
              <Text className="text-md ml-1 text-gray-400">{item.messageTime}</Text>
            </View>
          </View>

          {/* Selection Indicator or Unread Badge */}
          <View className="h-10 w-10 items-center justify-center">
            <>
              <Animated.View
                style={animatedCheckStyle}
                className="absolute h-7 w-7 items-center justify-center rounded-full bg-green-500">
                <MaterialIcons name="check" size={18} color="#fff" />
              </Animated.View>
              <Animated.View
                style={animatedBorderStyle}
                className="absolute h-7 w-7 rounded-full border-2 border-gray-600"
              />
            </>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
};

export default function ConversationList({
  conversations,
  onDeleteConversations,
  onConversationPress,
  refreshControl,
}: ConversationListProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const copy = { ...prev };
      if (copy[id]) delete copy[id];
      else copy[id] = true;
      return copy;
    });
  };

  const clearSelection = () => setSelected({});

  const deleteSelected = () => {
    if (selectedCount === 0) return;
    const selectedIds = Object.keys(selected).filter((id) => selected[id]);
    Alert.alert(
      `Delete ${selectedCount} conversation${selectedCount > 1 ? 's' : ''}?`,
      'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDeleteConversations(selectedIds);
            clearSelection();
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: Conversation }) => {
    const isSelected = !!selected[item.id];

    return (
      <AnimatedConversationItem
        item={item}
        isSelected={isSelected}
        onLongPress={() => toggleSelect(item.id)}
        onPress={() => {
          if (selectedCount > 0) {
            toggleSelect(item.id);
          } else if (onConversationPress) {
            onConversationPress(item);
          }
        }}
      />
    );
  };

  return (
    <>
      {/* Action bar shown when one or more items are selected */}
      {selectedCount > 0 && (
        <View className="flex flex-row items-center justify-between border-b border-gray-800 bg-[#0a0a0a] px-4 py-3">
          <View className="flex-row items-center">
            <TouchableOpacity onPress={deleteSelected} className="mr-4">
              <MaterialIcons name="delete" size={24} color="#fff" />
            </TouchableOpacity>
            <Text className="text-base font-semibold text-white">{selectedCount} selected</Text>
          </View>
          <TouchableOpacity onPress={clearSelection}>
            <Text className="text-[15px] text-gray-400">Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Conversation list */}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View className="mx-4 h-[1px] bg-[#1a1a1a]" />}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={refreshControl}
      />
    </>
  );
}
