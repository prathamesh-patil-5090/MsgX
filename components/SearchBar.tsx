import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

interface SearchBarProps {
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
}

export default function SearchBar({ onSearchFocus, onSearchBlur }: SearchBarProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState<string>('');

  const handleEnter = (search: string) => {
    onSearchFocus?.();
    router.push(`/search_params/${search}`);
  };

  const handleSubmit = (text: string) => {
    onSearchFocus?.();
    router.push({ pathname: '/search_params', params: { q: text } });
  };

  return (
    <View style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 16 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#1a1a1a',
          borderRadius: 10,
          paddingHorizontal: 12,
          height: 45,
        }}>
        <Ionicons name="search" size={20} color="#666666" style={{ marginRight: 8 }} />
        <TextInput
          placeholder="Search Messages..."
          placeholderTextColor={'#666666'}
          value={searchInput}
          onChangeText={setSearchInput}
          onFocus={() => onSearchFocus?.()}
          onBlur={() => onSearchBlur?.()}
          returnKeyType='search'
          onSubmitEditing={(e) => handleSubmit(searchInput)}
          style={{
            flex: 1,
            color: '#666666',
            fontSize: 16,
          }}></TextInput>
      </View>
    </View>
  );
}
