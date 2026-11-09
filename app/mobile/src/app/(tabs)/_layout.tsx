// 下タブ 3 つ（今日・建物・友達）。PC 幅（900px 以上の Web）では左のレール（幅 88px・アイコンの下に文字）。
// 本文は各画面の Screen が、残りの幅の中央に 560px の列で置く。

import { router } from 'expo-router';
import { Tabs, type BottomTabHeaderProps } from 'expo-router/js-tabs';
import { Platform, Pressable, useWindowDimensions } from 'react-native';
import { ColumnHeader } from '../../components/ColumnHeader';
import { BuildingIcon, FriendsIcon, GearIcon, HomeIcon } from '../../components/Icons';
import { tap } from '../../lib/haptics';
import { TABS, tabBarLookFor, type TabName } from '../../lib/navLayout';
import { color, touch } from '../../theme';

const ICONS: Record<TabName, typeof HomeIcon> = { index: HomeIcon, tower: BuildingIcon, friends: FriendsIcon };

// タブの画面の上の帯（戻る矢印なし）。本文の列にそろえる
function tabHeader({ options, route }: BottomTabHeaderProps) {
  const right = options.headerRight?.({ tintColor: color.primary, canGoBack: false });
  return <ColumnHeader title={options.title ?? route.name} right={right} />;
}

// 友達タブの右上の歯車。押すと設定へ
function SettingsGear() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="設定"
      testID="open-settings"
      hitSlop={8}
      onPress={() => {
        tap();
        router.push('/settings');
      }}
      style={{ minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' }}
    >
      <GearIcon color={color.primary} size={26} />
    </Pressable>
  );
}

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const look = tabBarLookFor(width, Platform.OS);
  const rail = look.railWidth !== null;
  return (
    <Tabs
      screenOptions={{
        header: tabHeader,
        tabBarPosition: look.tabBarPosition,
        tabBarVariant: look.tabBarVariant,
        tabBarLabelPosition: look.tabBarLabelPosition,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.muted,
        // 下タブの文字だけ theme.ts の「14 以上」の例外（12）。アイコンの下の狭い所に 3 つ並ぶため。
        // lineHeight を付けないと下半分が欠けるので、文字より高く取る。
        tabBarLabelStyle: { fontWeight: '700', fontSize: 12, lineHeight: 16 },
        tabBarStyle: rail
          ? { width: look.railWidth!, backgroundColor: color.surface, borderRightWidth: 1, borderColor: color.line }
          : { backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      {TABS.map((t) => {
        const Icon = ICONS[t.name];
        return (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarAccessibilityLabel: t.title,
              tabBarButtonTestID: `tab-${t.name}`,
              tabBarIcon: ({ color: c }) => <Icon color={String(c)} />,
              // 今日はホームが自分の帯（連続記録・建物の階数）を持つので、上の帯を出さない
              headerShown: t.name !== 'index',
              headerRight: t.name === 'friends' ? () => <SettingsGear /> : undefined,
            }}
          />
        );
      })}
    </Tabs>
  );
}
