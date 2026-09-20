import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ animation: 'slide_from_right' }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      {/*
        No header. Both screens draw their own back control, because each is
        reachable from outside this stack (Settings › Accounts), where a header
        back button has no previous screen to offer and does not appear.
      */}
      <Stack.Screen name="create" options={{ headerShown: false }} />
      <Stack.Screen name="import" options={{ headerShown: false }} />
    </Stack>
  );
}
