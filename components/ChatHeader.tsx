import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { withAuthErrorHandling } from 'services/authUtils';
import { getCurrentUserProfile, type UserProfile } from 'services/userApi';
import SearchBar from './SearchBar';

interface ChatHeaderProps {
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
}

export default function ChatHeader({ onSearchFocus, onSearchBlur }: ChatHeaderProps) {
  const router = useRouter();
  const [userInitials, setUserInitials] = useState<string>('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadUserInitials();
  }, []);

  const loadUserInitials = async () => {
    console.log('[ChatHeader] Loading user profile...');

    setUserInitials('TU');
    setIsLoading(true);

    const result = await withAuthErrorHandling(async () => {
      const response = await getCurrentUserProfile();
      console.log('[ChatHeader] Profile response:', response);
      return response;
    }, false);

    if (result) {
      const initials = `${result.user.first_name.charAt(0)}${result.user.last_name.charAt(0)}`;
      const finalInitials = initials.toUpperCase();
      console.log('[ChatHeader] Setting initials:', finalInitials);
      setUserInitials(finalInitials);
      setUserProfile(result.user);
    } else {
      console.warn('[ChatHeader] Failed to load profile, keeping fallback');
    }

    setIsLoading(false);
  };

  const handleProfilePress = () => {
    if (userProfile) {
      router.push({
        pathname: '/profile',
        params: {
          profileData: JSON.stringify(userProfile),
        },
      });
    } else {
      router.push('/profile');
    }
  };

  return (
    <View className="bg-black">
      <View className="flex-row items-center px-4 py-2">
        {/* Search Bar Container */}
        <View className="flex-1">
          <SearchBar onSearchFocus={onSearchFocus} onSearchBlur={onSearchBlur} />
        </View>

        {/* Profile Button */}
        <TouchableOpacity
          onPress={handleProfilePress}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#4A9EFF',
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 12,
            marginTop: 16,
            marginBottom: 16,
          }}
          activeOpacity={0.8}
          disabled={false}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: 'bold',
              color: 'white',
            }}>
            {userInitials || 'TU'}
          </Text>
          {isLoading && (
            <View
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#00FF00',
              }}
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
