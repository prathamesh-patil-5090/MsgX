import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

interface EmptyStateProps {
  title: string;
  subtitle: string;
  iconName?: keyof typeof MaterialCommunityIcons.glyphMap;
}

export default function EmptyState({
  title,
  subtitle,
  iconName = 'message-alert-outline'
}: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <MaterialCommunityIcons
        name={iconName}
        size={120}
        color="#ffffff"
        style={{ marginBottom: 24 }}
      />
      <Text className="text-center text-2xl font-semibold text-white">{title}</Text>
      <Text className="mt-3 text-center text-base text-gray-400">{subtitle}</Text>
    </View>
  );
}
