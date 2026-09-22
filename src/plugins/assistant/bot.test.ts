import AsyncStorage from '@react-native-async-storage/async-storage';

import { useChatStore } from '@/core/messaging/chat-store';
import { projectTestAccount, resetChatStore } from '@/core/messaging/testing/store';
import { deleteAccountDatabase } from '@/storage/database';
import { makeStatusBot } from './bot';

beforeEach(async () => {
  await AsyncStorage.clear();
  resetChatStore();
  await deleteAccountDatabase('status-test');
  projectTestAccount('status-test');
});

it('keeps ordinary notes quiet and pages Status history from account SQLite', async () => {
  const bot = makeStatusBot();
  await useChatStore.getState().registerBots([bot]);
  const welcomeLength = useChatStore.getState().messages['local-status'].length;

  for (let index = 0; index < 205; index++) {
    await useChatStore.getState().sendMessage('local-status', {
      kind: 'text',
      text: `Remember how to help with item ${index}`,
    });
  }
  expect(useChatStore.getState().messages['local-status']).toHaveLength(welcomeLength + 205);

  resetChatStore();
  projectTestAccount('status-test');
  await useChatStore.getState().registerBots([makeStatusBot()]);
  const restored = useChatStore.getState().messages['local-status'];
  expect(restored).toHaveLength(welcomeLength + 205);
  expect(restored[welcomeLength].content).toEqual({
    kind: 'text',
    text: 'Remember how to help with item 0',
  });
  expect(restored.at(-1)?.content).toEqual({
    kind: 'text',
    text: 'Remember how to help with item 204',
  });
  await deleteAccountDatabase('status-test');
});
