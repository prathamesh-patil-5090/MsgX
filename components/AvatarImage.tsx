import { Image, ImageSourcePropType, Text, View } from 'react-native';

interface AvatarImageProps {
  source?: ImageSourcePropType | null;
  name: string;
  size?: number;
  textSize?: number;
}

const getInitials = (name: string): string => {
  const words = name.trim().split(' ');
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

const getColorFromName = (name: string): string => {
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#FFA07A', // Light Salmon
    '#98D8C8', // Mint
    '#F7DC6F', // Yellow
    '#BB8FCE', // Purple
    '#85C1E2', // Sky Blue
    '#F8B88B', // Peach
    '#A8E6CF', // Light Green
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

export default function AvatarImage({
  source,
  name,
  size = 64,
  textSize
}: AvatarImageProps) {
  const calculatedTextSize = textSize || size * 0.4;

  // If we have a valid image source, show the image
  if (source) {
    return (
      <Image
        source={source}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  // Otherwise show text-based avatar with initials
  const initials = getInitials(name);
  const backgroundColor = getColorFromName(name);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text
        style={{
          color: '#ffffff',
          fontSize: calculatedTextSize,
          fontWeight: '600',
        }}>
        {initials}
      </Text>
    </View>
  );
}
