import { loadGifKey, saveGifKey } from '@/features/chat/attachments/gifs';
import { ApiKeyScreen } from '@/features/settings/api-key-screen';

export default function GifSettingsScreen() {
  return (
    <ApiKeyScreen
      title="GIFs"
      sectionTitle="KLIPY API key"
      testIdPrefix="gif-key"
      placeholder="Your KLIPY key"
      load={loadGifKey}
      save={saveGifKey}
      savedMessage="GIF search is on"
      notes={[
        'No key ships with this app, and none is shared between accounts. Without one you can ' +
          'still send GIFs from your photo library like any other image. A key only adds search.',
        'Searches go straight from this device to KLIPY, so they are visible to them. Nothing ' +
          'about them passes through this app.',
        'To get one, sign up at partner.klipy.com, open API Keys, add a platform and copy the ' +
          'key it creates. A test key allows 100 searches an hour; the same panel lets you ask ' +
          'for production access if you need more.',
      ]}
      link={{
        label: 'Get a KLIPY key',
        url: 'https://partner.klipy.com/api-keys',
      }}
    />
  );
}
