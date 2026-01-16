import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isAuthenticated } from 'services/authUtils';

export default function Index() {
  const [isChecking, setIsChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authStatus = await isAuthenticated();
        setAuthenticated(authStatus);
      } catch (error) {
        console.error('Error checking authentication:', error);
        setAuthenticated(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkAuth();
  }, []);

  if (isChecking) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: 'black',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <ActivityIndicator size="large" color="#4A9EFF" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <Redirect href={authenticated ? '/(tabs)/dm/' : '/login'} />
    </View>
  );
}
