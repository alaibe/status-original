import { Stack } from 'expo-router';
import { useThemeColors } from '@/design';

export const unstable_settings = { initialRouteName: 'chats' };

export default function TabStackLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTransparent: false,
        contentStyle: { backgroundColor: colors.canvas },
        animation: 'slide_from_right',
      }}
    />
  );
}
