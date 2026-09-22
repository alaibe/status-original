import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useThemeColors } from '../hooks/use-theme-colors';
import { cn } from '../lib/cn';
import { Icon, type IconName } from '../icon';
import { ListItem } from './list-item';
import { SearchField } from './search-field';
import { closeSheetThen, Sheet, type SheetProps } from './sheet';
import { Text } from './text';

export interface SheetAction {
  label: string;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  icon?: IconName;
  /** Shows a checkmark, for sheets that pick one of several. */
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}

export interface ActionSheetProps extends Omit<SheetProps, 'children'> {
  /** Picking one closes the sheet before it runs. */
  actions: SheetAction[];
  searchFor?: string;
}

/**
 * Below this a list is quicker to read than to filter, and short enough to
 * wear as chips rather than hide behind a picker.
 */
export const MANY_OPTIONS = 8;

/** Enough to show there is more, without the sheet taking the screen. */
const LIST_MAX = 360;

export function ActionSheet({ actions, searchFor, ...sheet }: ActionSheetProps) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');

  const searchable = actions.length >= MANY_OPTIONS;
  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!searchable || !wanted) return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(wanted));
  }, [actions, query, searchable]);

  return (
    <Sheet {...sheet}>
      {searchable ? (
        <SearchField
          placeholder={searchFor ? `Search ${searchFor}` : 'Search'}
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          returnKeyType="search"
          testID="sheet-search"
        />
      ) : null}
      <Scroller searchable={searchable}>
        <View style={{ borderCurve: 'continuous' }} className="overflow-hidden rounded-card bg-surface-raised">
          {shown.length === 0 ? (
            <View className="px-4 py-6">
              <Text variant="caption" className="text-center">
                Nothing matches “{query.trim()}”.
              </Text>
            </View>
          ) : null}
          {shown.map((action, i) => {
            const color = action.tone && action.tone !== 'neutral' ? colors[action.tone] : colors.content;
            return (
              <ListItem
                key={`${action.label}-${i}`}
                testID={action.testID}
                accessibilityLabel={action.label}
                className={cn('px-4', i > 0 && 'border-t border-line')}
                title={
                  <Text className="font-medium" style={{ color }}>
                    {action.label}
                  </Text>
                }
                leading={action.icon ? <Icon name={action.icon} size={20} color={color} /> : undefined}
                trailing={
                  action.selected ? (
                    <Icon name="checkmark" size={18} color={colors.brand} />
                  ) : undefined
                }
                onPress={() => closeSheetThen(sheet, action.onPress)}
              />
            );
          })}
        </View>
      </Scroller>
    </Sheet>
  );
}

/**
 * A sheet sizes itself to its contents, and a ScrollView has no size of its
 * own to give it, so only a list long enough to need scrolling gets one.
 */
function Scroller({ searchable, children }: { searchable: boolean; children: React.ReactNode }) {
  if (!searchable) return children;
  return (
    <ScrollView
      style={{ maxHeight: LIST_MAX }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}
