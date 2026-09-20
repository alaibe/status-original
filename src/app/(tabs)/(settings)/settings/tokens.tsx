import { loadTokenKey, saveTokenKey } from '@/core/identity/token-key';
import { ApiKeyScreen } from '@/features/settings/api-key-screen';

export default function TokenSettingsScreen() {
  return (
    <ApiKeyScreen
      title="Tokens"
      sectionTitle="Alchemy API key"
      testIdPrefix="token-key"
      placeholder="alch_…"
      load={loadTokenKey}
      save={saveTokenKey}
      savedMessage="Tokens will show up"
      notes={[
        'No key ships with this app, and none is shared between accounts. One key covers ' +
          'Ethereum, Base, Optimism, Arbitrum and Polygon. Without one, every native balance and ' +
          'every send still works. The list of tokens you hold is the only part that goes ' +
          'missing.',
        'Lookups go straight from this device to Alchemy, so the addresses you check are ' +
          'visible to them. Nothing about them passes through this app. If you already point a ' +
          'chain at your own Alchemy endpoint with /rpc, this is the same key.',
      ]}
      link={{ label: 'Get an Alchemy key', url: 'https://dashboard.alchemy.com/' }}
    />
  );
}
