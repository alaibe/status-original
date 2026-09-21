import { useRouter, type Href } from 'expo-router';

export function useBack(fallback: Href) {
  const router = useRouter();

  return () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(fallback);
  };
}
