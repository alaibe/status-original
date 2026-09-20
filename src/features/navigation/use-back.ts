import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

export function useBack(fallback: Href) {
  const router = useRouter();

  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(fallback);
  }, [router, fallback]);
}
