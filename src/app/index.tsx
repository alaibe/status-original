import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useIdentityStore } from '@/core/identity/identity-store';

export default function Index() {
  const status = useIdentityStore((s) => s.status);

  if (status === 'ready') return <Redirect href="/chats" />;

  if (status === 'invalidated') return <Redirect href="/recover" />;

  if (status === 'loading' || status === 'blocked' || status === 'error') {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href="/(onboarding)/welcome" />;
}
