
import { Text } from '@/design';
export interface ContactNameProps {
  given?: string | null;
  family?: string | null;
  fallback?: string;
}

export function ContactName({ given, family, fallback }: ContactNameProps) {
  const first = given?.trim();
  const last = family?.trim();

  if (!first && !last) return <>{fallback ?? 'Unknown'}</>;
  if (!last) return <>{first}</>;
  if (!first) return <Text className="font-semibold">{last}</Text>;

  return (
    <>
      {first} <Text className="font-semibold">{last}</Text>
    </>
  );
}
