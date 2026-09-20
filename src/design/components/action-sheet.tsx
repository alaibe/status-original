import { View } from 'react-native';

import { Button } from './button';
import { Sheet } from './sheet';

export interface SheetAction {
  label: string;
  tone?: 'neutral' | 'danger' | 'primary';
  onPress: () => void;
  testID?: string;
}

export interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Picking one closes the sheet before it runs. */
  actions: SheetAction[];
}

export function ActionSheet({ visible, onClose, title, actions }: ActionSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View className="gap-2 pb-2">
        {actions.map((action, i) => (
          <Button
            key={`${action.label}-${i}`}
            testID={action.testID}
            label={action.label}
            tone={action.tone ?? 'neutral'}
            fullWidth
            onPress={() => {
              onClose();
              action.onPress();
            }}
          />
        ))}
        <Button label="Cancel" tone="ghost" fullWidth onPress={onClose} />
      </View>
    </Sheet>
  );
}
