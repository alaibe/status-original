import { loadTradeKey, saveTradeKey } from '@/core/identity/trade-key';
import { ApiKeyScreen } from '@/features/settings/api-key-screen';

export default function TradeSettingsScreen() {
  return (
    <ApiKeyScreen
      title="Trades"
      sectionTitle="LI.FI API key"
      testIdPrefix="trade-key"
      placeholder="Your LI.FI key"
      load={loadTradeKey}
      save={saveTradeKey}
      savedMessage="Trades use your key"
      notes={[
        '/trade swaps and bridges through LI.FI, and works without a key: LI.FI allows this ' +
          'device about 75 quotes every two hours, which is plenty for a personal wallet. A key ' +
          'raises that to 100 a minute. No key ships with this app, and none is shared between ' +
          'accounts.',
        'Quotes go straight from this device to LI.FI, so the address, tokens and amounts you ' +
          'trade are visible to them. Nothing passes through this app. The trade itself is ' +
          'signed here and sent to the network like any other transaction.',
        'To get one, sign up at portal.li.fi, create an integrator and copy its API key.',
      ]}
      link={{ label: 'Get a LI.FI key', url: 'https://portal.li.fi/' }}
    />
  );
}
