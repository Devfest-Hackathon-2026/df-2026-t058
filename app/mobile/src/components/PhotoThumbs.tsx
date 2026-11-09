// 相談に付ける写真の小さなつまみ（サムネイル）。×で外せる。

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space } from '../theme';

const SIZE = 56;

export function PhotoThumbs(props: { uris: string[]; onRemove: (index: number) => void; testID?: string }) {
  const { uris, onRemove, testID = 'photo' } = props;
  if (uris.length === 0) return null;
  return (
    <View style={styles.row}>
      {uris.map((uri, i) => (
        <View key={`${i}-${uri.length}`} style={styles.thumb}>
          <Image source={{ uri }} style={styles.img} accessibilityLabel={`写真 ${i + 1}`} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`写真 ${i + 1} を外す`}
            onPress={() => onRemove(i)}
            hitSlop={12}
            style={styles.x}
            testID={`${testID}-remove-${i}`}
          >
            <Text style={styles.xText}>×</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  thumb: { width: SIZE, height: SIZE },
  img: { width: SIZE, height: SIZE, borderRadius: radius.box, backgroundColor: color.surfaceSunk },
  x: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: color.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xText: { color: color.onPrimary, fontSize: font.small, fontWeight: '900', lineHeight: 16 },
});
