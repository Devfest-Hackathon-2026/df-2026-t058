// プライバシーポリシー（Issue #238）。ログインしていなくても読める（_layout が AuthGate を通さない）。
// 本文は lib/privacyText.ts。ここは描くだけで、サーバーは呼ばない。

import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/ui';
import { PRIVACY_SECTIONS, PRIVACY_TITLE, PRIVACY_UPDATED } from '../lib/privacyText';
import { useTabTitle } from '../lib/tabTitle';
import { color, font, space } from '../theme';

export default function Privacy() {
  useTabTitle(PRIVACY_TITLE);
  return (
    <Screen>
      {PRIVACY_SECTIONS.map((s) => (
        <View key={s.heading} style={styles.section} testID="privacy-section">
          <Text accessibilityRole="header" style={styles.heading}>
            {s.heading}
          </Text>
          {s.lines.map((line, i) => (
            <Text key={i} style={styles.line} selectable>
              {line}
            </Text>
          ))}
        </View>
      ))}
      <Text style={styles.updated} testID="privacy-updated">
        更新日: {PRIVACY_UPDATED}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { fontSize: font.large, fontWeight: '800', color: color.text },
  line: { fontSize: font.body, lineHeight: 26, color: color.text },
  updated: { fontSize: font.small, color: color.muted },
});
