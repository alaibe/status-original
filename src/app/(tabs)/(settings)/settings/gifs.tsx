import { loadGifKey, saveGifKey } from '@/features/chat/attachments/gifs';
import { ApiKeyScreen } from '@/features/settings/api-key-screen';

export default function GifSettingsScreen() {
  return (
    <ApiKeyScreen
      title="GIFs"
      sectionTitle="Tenor API key"
      testIdPrefix="gif-key"
      placeholder="AIza…"
      load={loadGifKey}
      save={saveGifKey}
      savedMessage="GIF search is on"
      notes={[
        'No key ships with this app, and none is shared between accounts. Without one you can ' +
          'still send GIFs from your photo library like any other image. A key only adds search.',
        'Searches go straight from this device to Tenor, so they are visible to Google and to ' +
          'whoever issued the key. Nothing about them passes through this app.',
      ]}
      link={{
        label: 'Get a Tenor key',
        url: 'https://console.cloud.google.com/apis/library/tenor.googleapis.com',
      }}
    />
  );
}
